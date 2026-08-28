import {
    composePromptWithAttachment,
    createAttachmentHistoryText as defaultCreateAttachmentHistoryText,
    loadAttachmentText as defaultLoadAttachmentText
} from '../attachmentLoader.js';
import {
    clearCompletedGeneration as defaultClearCompletedGeneration,
    completeGeneration as defaultCompleteGeneration,
    registerGeneration as defaultRegisterGeneration
} from '../generationRegistry.js';
import { createLogger } from '../logger.js';
import * as messageUtils from '../messageUtils.js';
import * as ollamaClient from '../ollamaClient.js';
import { isResponseAbortedError } from '../ollamaClient.js';
import { resolveSpeakerName as defaultResolveSpeakerName } from '../speakerUtils.js';
import * as threadManager from '../threadManager.js';

const logger = createLogger('threadMessageHandler');
const threadQueues = new Map();

async function defaultFetchReferencedMessage(message) {
    return await message.fetchReference();
}

export async function handleThreadMessage(message, deps = {}) {
    if (!message.channel.isThread()) return;
    if (message.author.bot) return;

    const threadId = message.channel.id;
    const { clearCompletedGeneration = defaultClearCompletedGeneration } = deps;
    clearCompletedGeneration(threadId);
    return await enqueueThreadTask(threadId, () => processThreadMessage(message, deps));
}

function enqueueThreadTask(threadId, task) {
    const previousTask = threadQueues.get(threadId) || Promise.resolve();
    const queuedTask = previousTask.catch(() => {}).then(task);

    threadQueues.set(threadId, queuedTask);
    queuedTask
        .finally(() => {
            if (threadQueues.get(threadId) === queuedTask) {
                threadQueues.delete(threadId);
            }
        })
        .catch(() => {});

    return queuedTask;
}

async function processThreadMessage(message, deps = {}) {
    const {
        buildMaidThinkingMessage = messageUtils.buildMaidThinkingMessage,
        sendSplitMessage = messageUtils.sendSplitMessage,
        generateResponse = ollamaClient.generateResponse,
        addToThreadHistory = threadManager.addToThreadHistory,
        getThreadHistory = threadManager.getThreadHistory,
        resolveSpeakerName = defaultResolveSpeakerName,
        fetchReferencedMessage = defaultFetchReferencedMessage,
        loadAttachmentText = defaultLoadAttachmentText,
        composePromptWithAttachment: composeAttachmentPrompt = composePromptWithAttachment,
        createAttachmentHistoryText: createHistoryText = defaultCreateAttachmentHistoryText,
        registerGeneration = defaultRegisterGeneration,
        completeGeneration = defaultCompleteGeneration,
        setThreadHistory = threadManager.setThreadHistory
    } = deps;

    const threadId = message.channel.id;
    const history = getThreadHistory(threadId);
    logger.info('Handling thread follow-up message', {
        threadId,
        authorId: message.author?.id || null,
        messageLength: message.content?.length || 0
    });

    let replyContext = '';
    if (message.reference?.messageId) {
        try {
            const referencedMessage = await fetchReferencedMessage(message);
            if (referencedMessage?.content) {
                replyContext = messageUtils.formatQuotedReference(referencedMessage);
            }
        } catch (err) {
            logger.warn('Failed to resolve referenced message', err, {
                threadId,
                referenceId: message.reference.messageId
            });
        }
    }

    const messageText = message.content || '';
    const attachments = Array.from(message.attachments?.values?.() || []);
    let responsePrompt = messageText;
    let historyPrompt = messageText;

    if (attachments.length > 1) {
        await message.channel.send('添付ファイルは最初の1件のみ読み込みます。');
    }

    if (attachments[0]) {
        try {
            const result = await loadAttachmentText(attachments[0]);
            if (result.ok) {
                responsePrompt = composeAttachmentPrompt(messageText, result);
                historyPrompt = createHistoryText(messageText, result);
            } else {
                await message.channel.send(result.message);
            }
        } catch (err) {
            logger.warn('Failed to load thread attachment', err, { threadId });
            await message.channel.send('添付ファイルのダウンロードに失敗しました。');
        }
    }

    if (!responsePrompt.trim()) {
        await message.channel.send('質問文または読み込めるテキストファイルを送信してください。');
        return;
    }

    const composedText = replyContext ? `${replyContext}\n${responsePrompt}` : responsePrompt;
    const historyText = replyContext ? `${replyContext}\n${historyPrompt}` : historyPrompt;
    const speaker = resolveSpeakerName(message);

    addToThreadHistory(threadId, {
        role: 'user',
        text: historyText,
        speaker
    });

    const generation = {
        channel: message.channel,
        threadId,
        prompt: composedText,
        history,
        speaker,
        userId: message.author?.id,
        buildThinking: buildMaidThinkingMessage,
        sendSplitMessage,
        generateResponse,
        addToThreadHistory,
        getThreadHistory,
        setThreadHistory,
        registerGeneration,
        completeGeneration,
        deps
    };

    try {
        await runThreadGeneration(generation);
    } catch (err) {
        logger.error('Error generating follow-up', err, {
            threadId
        });
        await message.channel.send('エラーが発生しました。');
    }
}

async function runThreadGeneration(generation) {
    const thinkingMsg = await generation.channel.send(generation.buildThinking());
    await addGenerationReactions(thinkingMsg);

    const controller = new AbortController();
    const entry = generation.registerGeneration(generation.threadId, {
        controller,
        thinkingMsg,
        userId: generation.userId
    });
    entry.regenerate = async () => {
        if (entry.state === 'completed') {
            const currentHistory = generation.getThreadHistory(generation.threadId);
            if (currentHistory.at(-1)?.role === 'assistant') {
                generation.setThreadHistory(generation.threadId, currentHistory.slice(0, -1));
            }
        }

        return await enqueueThreadTask(generation.threadId, async () => {
            await runThreadGeneration(generation);
        });
    };

    try {
        const responseText = await generation.generateResponse(
            generation.prompt,
            generation.history,
            {
                speaker: generation.speaker,
                signal: controller.signal
            }
        );
        if (controller.signal.aborted) {
            throw new Error('Response aborted by user');
        }

        generation.addToThreadHistory(generation.threadId, {
            role: 'assistant',
            text: responseText
        });
        await generation.sendSplitMessage(generation.channel, responseText, thinkingMsg);
        generation.completeGeneration(generation.threadId, entry);
        logger.info('Completed thread follow-up response', {
            threadId: generation.threadId,
            responseLength: responseText.length
        });
    } catch (err) {
        if (isResponseAbortedError(err) || controller.signal.aborted) {
            await showGenerationStopped(thinkingMsg, entry.abortMessage || '✖️ 中断しました。');
            return;
        }

        generation.completeGeneration(generation.threadId, entry);
        throw err;
    }
}

async function addGenerationReactions(thinkingMsg) {
    if (typeof thinkingMsg?.react !== 'function') return;

    for (const emoji of ['❌', '🔄']) {
        try {
            await thinkingMsg.react(emoji);
        } catch (err) {
            logger.warn('Failed to add generation control reaction', err, { emoji });
        }
    }
}

async function showGenerationStopped(thinkingMsg, content) {
    await thinkingMsg.edit(content).catch(() => {});
    await thinkingMsg.reactions?.removeAll?.().catch(() => {});
}
