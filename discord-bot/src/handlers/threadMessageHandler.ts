import type { AttachmentLike, AttachmentLoadResult } from '../attachmentLoader.ts';
import {
    composePromptWithAttachment,
    createAttachmentHistoryText as defaultCreateAttachmentHistoryText,
    loadAttachmentText as defaultLoadAttachmentText
} from '../attachmentLoader.ts';
import type {
    GenerationDetails,
    GenerationEntry,
    GenerationMessage
} from '../generationRegistry.ts';
import {
    clearCompletedGeneration as defaultClearCompletedGeneration,
    completeGeneration as defaultCompleteGeneration,
    registerGeneration as defaultRegisterGeneration
} from '../generationRegistry.ts';
import { createLogger } from '../logger.ts';
import type { ManagedThreadChannel } from '../managedThreadRegistry.ts';
import { isManagedThread as defaultIsManagedThread } from '../managedThreadRegistry.ts';
import type { EditableMessage, ReferencedMessage, SendableChannel } from '../messageUtils.ts';
import * as messageUtils from '../messageUtils.ts';
import * as ollamaClient from '../ollamaClient.ts';
import { isResponseAbortedError } from '../ollamaClient.ts';
import type { SpeakerSource } from '../speakerUtils.ts';
import { resolveSpeakerName as defaultResolveSpeakerName } from '../speakerUtils.ts';
import type { HistoryEntry } from '../threadManager.ts';
import * as threadManager from '../threadManager.ts';

const logger = createLogger('threadMessageHandler');
const threadQueues = new Map<string, Promise<void>>();

interface ThreadUser {
    id?: string;
    bot?: boolean;
}

interface ThreadChannel extends ManagedThreadChannel, SendableChannel {
    id: string;
    isThread(): boolean;
    send(content: string | object): Promise<unknown>;
}

export interface ThreadMessage extends SpeakerSource {
    channel: {
        id?: string;
        isThread(): boolean;
        send?(content: string | object): Promise<unknown>;
        ownerId?: string | null | undefined;
        client?: { user?: { id?: string } | null } | undefined;
        fetchStarterMessage?: ManagedThreadChannel['fetchStarterMessage'] | undefined;
    };
    author: { id?: string; bot?: boolean; globalName?: string | null; username?: string | null };
    content?: string | null;
    mentions?:
        | {
              repliedUser?: ThreadUser | null;
              users?: { values?(): IterableIterator<ThreadUser> };
              roles?: unknown;
              everyone?: boolean;
          }
        | undefined;
    reference?: { messageId?: string | null | undefined } | null | undefined;
    attachments?: { values?(): IterableIterator<AttachmentLike> } | undefined;
    client?: { user?: { id?: string } | null } | undefined;
    fetchReference?(): Promise<ReferencedMessage>;
}

export interface ThreadMessageDependencies {
    clientId?: string | undefined;
    clearCompletedGeneration(threadId: string): void;
    isManagedThread(
        channel: ManagedThreadChannel,
        options?: { clientId?: string | undefined }
    ): Promise<boolean>;
    buildMaidThinkingMessage(): string;
    sendSplitMessage(
        channel: SendableChannel,
        text: string,
        firstMessageToEdit?: EditableMessage | null
    ): Promise<void>;
    generateResponse(
        prompt: string,
        history: readonly HistoryEntry[],
        options?: { speaker?: string | undefined; signal?: AbortSignal | undefined }
    ): Promise<string>;
    addToThreadHistory(threadId: string, entry: HistoryEntry): unknown;
    getThreadHistory(threadId: string): HistoryEntry[];
    resolveSpeakerName(source: SpeakerSource): string;
    fetchReferencedMessage(message: ThreadMessage): Promise<ReferencedMessage | null | undefined>;
    loadAttachmentText(attachment: AttachmentLike): Promise<AttachmentLoadResult>;
    composePromptWithAttachment(
        prompt: string,
        attachment: Extract<AttachmentLoadResult, { ok: true }>
    ): string;
    createAttachmentHistoryText(
        prompt: string,
        attachment: Extract<AttachmentLoadResult, { ok: true }>
    ): string;
    registerGeneration(threadId: string, details: GenerationDetails): unknown;
    completeGeneration(threadId: string, entry?: GenerationEntry): unknown;
    setThreadHistory(threadId: string, history: readonly HistoryEntry[]): void;
}

async function defaultFetchReferencedMessage(
    message: ThreadMessage
): Promise<ReferencedMessage | null> {
    if (!message.fetchReference) return null;
    return await message.fetchReference();
}

function isAddressedToOtherHuman(message: ThreadMessage, clientId?: string): boolean {
    if (!clientId) return false;

    const isOtherHuman = (user: ThreadUser | null | undefined) =>
        user?.id !== clientId && user?.bot === false;
    if (isOtherHuman(message.mentions?.repliedUser)) return true;

    const mentionedUsers = message.mentions?.users;
    if (typeof mentionedUsers?.values !== 'function') return false;

    for (const user of mentionedUsers.values()) {
        if (isOtherHuman(user)) return true;
    }

    return false;
}

export async function handleThreadMessage(
    message: ThreadMessage,
    deps: Partial<ThreadMessageDependencies> = {}
): Promise<void> {
    if (!message.channel.isThread()) return;
    if (message.author.bot) return;
    const { id: threadId, send } = message.channel;
    if (!threadId || !send) return;
    // The id/send checks above establish the stricter channel contract without changing identity.
    const channel = message.channel as ThreadChannel;

    const clientId = deps.clientId ?? message.client?.user?.id;
    if (isAddressedToOtherHuman(message, clientId)) return;

    const {
        clearCompletedGeneration = defaultClearCompletedGeneration,
        isManagedThread = defaultIsManagedThread
    } = deps;
    if (!(await isManagedThread(channel, { clientId }))) return;

    clearCompletedGeneration(threadId);
    return await enqueueThreadTask(threadId, () => processThreadMessage(message, channel, deps));
}

function enqueueThreadTask(threadId: string, task: () => Promise<void>): Promise<void> {
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

async function processThreadMessage(
    message: ThreadMessage,
    channel: ThreadChannel,
    deps: Partial<ThreadMessageDependencies> = {}
): Promise<void> {
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

    const threadId = channel.id;
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
        await channel.send('添付ファイルは最初の1件のみ読み込みます。');
    }

    if (attachments[0]) {
        try {
            const result = await loadAttachmentText(attachments[0]);
            if (result.ok) {
                responsePrompt = composeAttachmentPrompt(messageText, result);
                historyPrompt = createHistoryText(messageText, result);
            } else {
                await channel.send(result.message);
            }
        } catch (err) {
            logger.warn('Failed to load thread attachment', err, { threadId });
            await channel.send('添付ファイルのダウンロードに失敗しました。');
        }
    }

    if (!responsePrompt.trim()) {
        await channel.send('質問文または読み込めるテキストファイルを送信してください。');
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
        channel,
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
        completeGeneration
    };

    try {
        await runThreadGeneration(generation);
    } catch (err) {
        logger.error('Error generating follow-up', err, {
            threadId
        });
        await channel.send('エラーが発生しました。');
    }
}

interface ThreadGeneration {
    channel: ThreadChannel;
    threadId: string;
    prompt: string;
    history: readonly HistoryEntry[];
    speaker: string;
    userId?: string | undefined;
    buildThinking(): string;
    sendSplitMessage: ThreadMessageDependencies['sendSplitMessage'];
    generateResponse: ThreadMessageDependencies['generateResponse'];
    addToThreadHistory: ThreadMessageDependencies['addToThreadHistory'];
    getThreadHistory: ThreadMessageDependencies['getThreadHistory'];
    setThreadHistory: ThreadMessageDependencies['setThreadHistory'];
    registerGeneration: ThreadMessageDependencies['registerGeneration'];
    completeGeneration: ThreadMessageDependencies['completeGeneration'];
}

function isGenerationEntry(value: unknown): value is GenerationEntry {
    return (
        typeof value === 'object' &&
        value !== null &&
        'controller' in value &&
        value.controller instanceof AbortController &&
        'thinkingMsg' in value &&
        typeof value.thinkingMsg === 'object' &&
        value.thinkingMsg !== null &&
        'edit' in value.thinkingMsg &&
        typeof value.thinkingMsg.edit === 'function' &&
        'threadId' in value &&
        typeof value.threadId === 'string' &&
        'state' in value &&
        (value.state === 'generating' || value.state === 'completed')
    );
}

function isGenerationMessage(
    value: unknown
): value is GenerationMessage & Required<Pick<GenerationMessage, 'edit'>> {
    return (
        typeof value === 'object' &&
        value !== null &&
        'edit' in value &&
        typeof value.edit === 'function'
    );
}

async function runThreadGeneration(generation: ThreadGeneration): Promise<void> {
    const sentMessage = await generation.channel.send(generation.buildThinking());
    if (!isGenerationMessage(sentMessage)) {
        throw new Error('Thinking message does not support editing.');
    }
    const thinkingMsg = sentMessage;
    await addGenerationReactions(thinkingMsg);

    const controller = new AbortController();
    const registered = generation.registerGeneration(generation.threadId, {
        controller,
        thinkingMsg,
        userId: generation.userId
    });
    if (!isGenerationEntry(registered)) {
        throw new Error('Generation registry returned an invalid entry.');
    }
    const entry = registered;
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

async function addGenerationReactions(thinkingMsg: GenerationMessage): Promise<void> {
    if (typeof thinkingMsg?.react !== 'function') return;

    for (const emoji of ['❌', '🔄']) {
        try {
            await thinkingMsg.react(emoji);
        } catch (err) {
            logger.warn('Failed to add generation control reaction', err, { emoji });
        }
    }
}

async function showGenerationStopped(
    thinkingMsg: GenerationMessage & Required<Pick<GenerationMessage, 'edit'>>,
    content: string
): Promise<void> {
    await thinkingMsg.edit(content).catch(() => {});
    await thinkingMsg.reactions?.removeAll?.().catch(() => {});
}
