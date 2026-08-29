import {
    composePromptWithAttachment,
    createAttachmentHistoryText,
    loadAttachmentText
} from '../attachmentLoader.js';
import { completeGeneration, registerGeneration } from '../generationRegistry.js';
import { createLogger } from '../logger.js';
import { MANAGED_THREAD_STARTER_CONTENT, registerManagedThread } from '../managedThreadRegistry.js';
import { buildMaidThinkingMessage, sendSplitMessage } from '../messageUtils.js';
import { generateResponse, isResponseAbortedError } from '../ollamaClient.js';
import { resolveSpeakerName } from '../speakerUtils.js';
import {
    addToThreadHistory,
    getThreadHistory,
    initializeThread,
    setThreadHistory
} from '../threadManager.js';
import { generateThreadName } from '../threadNaming.js';

const logger = createLogger('oCommand');

// デフォルトの依存関係
const defaultDeps = {
    buildMaidThinkingMessage,
    sendSplitMessage,
    generateResponse,
    getThreadHistory,
    addToThreadHistory,
    initializeThread,
    generateThreadName,
    resolveSpeakerName,
    loadAttachmentText,
    composePromptWithAttachment,
    createAttachmentHistoryText,
    setThreadHistory,
    registerGeneration,
    completeGeneration,
    registerManagedThread
};

export function createHandleOCommand(deps = defaultDeps) {
    const {
        buildMaidThinkingMessage: buildThinking,
        sendSplitMessage,
        generateResponse,
        getThreadHistory,
        addToThreadHistory,
        initializeThread,
        generateThreadName: nameThread,
        resolveSpeakerName,
        loadAttachmentText,
        composePromptWithAttachment,
        createAttachmentHistoryText,
        setThreadHistory,
        registerGeneration,
        completeGeneration,
        registerManagedThread: registerThread
    } = { ...defaultDeps, ...deps };

    return async function handleOCommand(interaction) {
        const prompt = interaction.options.getString('prompt');
        const attachment = interaction.options.getAttachment?.('file') || null;
        logger.info('Received /o command', {
            userId: interaction.user?.id || null,
            promptLength: prompt?.length || 0,
            hasAttachment: Boolean(attachment)
        });

        await interaction.deferReply();

        try {
            let responsePrompt = prompt;
            let historyPrompt = prompt;
            let attachmentName = null;
            if (attachment) {
                const result = await loadAttachmentText(attachment);
                if (!result.ok) {
                    await interaction.followUp({ content: result.message, ephemeral: true });
                    return;
                }

                responsePrompt = composePromptWithAttachment(prompt, result);
                historyPrompt = createAttachmentHistoryText(prompt, result);
                attachmentName = result.name;
            }

            const replyMsg = await interaction.followUp({
                content: MANAGED_THREAD_STARTER_CONTENT
            });

            const thread = await replyMsg.startThread({
                name: nameThread(prompt, interaction.user.username),
                autoArchiveDuration: 60
            });
            logger.info('Created response thread for /o command', {
                threadId: thread.id,
                userId: interaction.user?.id || null
            });

            registerThread(thread.id);
            initializeThread(thread.id);
            const history = getThreadHistory(thread.id);
            const speaker = resolveSpeakerName(interaction);
            addToThreadHistory(thread.id, { role: 'user', text: historyPrompt, speaker });

            const threadIntro = [
                `**プロンプト:** ${prompt}`,
                attachmentName && `📎 添付: ${attachmentName}`
            ]
                .filter(Boolean)
                .join('\n');
            await thread.send({ content: threadIntro, allowedMentions: { parse: [] } });

            await runCommandGeneration({
                thread,
                prompt: responsePrompt,
                history,
                speaker,
                userId: interaction.user?.id,
                buildThinking,
                sendSplitMessage,
                generateResponse,
                addToThreadHistory,
                getThreadHistory,
                setThreadHistory,
                registerGeneration,
                completeGeneration
            });
        } catch (err) {
            if (isResponseAbortedError(err)) return;
            logger.error('Error handling /o command', err, {
                userId: interaction.user?.id || null
            });
            await interaction
                .followUp({
                    content: 'エラーが発生しました。',
                    ephemeral: true
                })
                .catch(() => {});
        }
    };
}

// デフォルトのエクスポート（後方互換性）
export const handleOCommand = createHandleOCommand();

async function runCommandGeneration(generation) {
    const thinkingMsg = await generation.thread.send(generation.buildThinking());
    await addGenerationReactions(thinkingMsg);

    const controller = new AbortController();
    const entry = generation.registerGeneration(generation.thread.id, {
        controller,
        thinkingMsg,
        userId: generation.userId
    });
    entry.regenerate = async () => {
        if (entry.state === 'completed') {
            const currentHistory = generation.getThreadHistory(generation.thread.id);
            if (currentHistory.at(-1)?.role === 'assistant') {
                generation.setThreadHistory(generation.thread.id, currentHistory.slice(0, -1));
            }
        }

        await runCommandGeneration(generation);
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

        generation.addToThreadHistory(generation.thread.id, {
            role: 'assistant',
            text: responseText
        });
        await generation.sendSplitMessage(generation.thread, responseText, thinkingMsg);
        generation.completeGeneration(generation.thread.id, entry);
        logger.info('Completed /o command response', {
            threadId: generation.thread.id,
            responseLength: responseText.length
        });
    } catch (err) {
        if (isResponseAbortedError(err) || controller.signal.aborted) {
            await showGenerationStopped(thinkingMsg, entry.abortMessage || '✖️ 中断しました。');
            return;
        }

        generation.completeGeneration(generation.thread.id, entry);
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
