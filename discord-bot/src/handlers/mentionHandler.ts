import { createLogger } from '../logger.ts';
import type { EditableMessage, SendableChannel } from '../messageUtils.ts';
import * as messageUtils from '../messageUtils.ts';
import * as ollamaClient from '../ollamaClient.ts';
import type { HistoryEntry } from '../threadManager.ts';
import * as threadManager from '../threadManager.ts';

const logger = createLogger('mentionHandler');
const mentionQueues = new Map<string, Promise<void>>();

export const EMPTY_MENTION_RESPONSE = 'ご主人様、なにかご用でしょうか？';

interface MentionChannel extends SendableChannel {
    id: string;
    isThread?(): boolean;
    send(content: string | object): Promise<EditableMessage>;
}

export interface MentionMessage {
    content?: string | null;
    channel?: MentionChannel | null;
    author?: { id?: string; bot?: boolean } | null;
    mentions?: {
        users?: { has?(id: string): boolean };
        has?(id: string): boolean;
    };
    client?: { user?: { id?: string } | null };
}

export interface MentionDependencies {
    clientId?: string | undefined;
    buildMaidThinkingMessage(): string;
    sendSplitMessage(
        channel: SendableChannel,
        text: string,
        firstMessageToEdit?: EditableMessage | null
    ): Promise<void>;
    generateResponse(prompt: string, history: readonly HistoryEntry[]): Promise<string>;
    addToThreadHistory(threadId: string, entry: HistoryEntry): unknown;
    getThreadHistory(threadId: string): HistoryEntry[];
}

export function extractMentionPrompt(
    content: string | null | undefined,
    clientId: string | null | undefined
): string {
    if (!content || !clientId) return '';

    const escapedClientId = String(clientId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return String(content)
        .replaceAll(new RegExp(`<@!?${escapedClientId}>`, 'g'), '')
        .trim();
}

function isMentioningClient(message: MentionMessage, clientId?: string): boolean {
    if (!clientId) return false;

    return Boolean(
        message.mentions?.users?.has?.(clientId) ||
            message.mentions?.has?.(clientId) ||
            message.content?.includes(`<@${clientId}>`) ||
            message.content?.includes(`<@!${clientId}>`)
    );
}

export async function handleMentionMessage(
    message: MentionMessage,
    deps: Partial<MentionDependencies> = {}
): Promise<void> {
    const channel = message.channel;
    if (!channel || channel.isThread?.()) return;
    if (message.author?.bot) return;

    const clientId = deps.clientId ?? message.client?.user?.id;
    if (!isMentioningClient(message, clientId)) return;
    if (!channel.id) return;

    return await enqueueMentionTask(channel.id, () =>
        processMentionMessage(message, channel, clientId, deps)
    );
}

function enqueueMentionTask(channelId: string, task: () => Promise<void>): Promise<void> {
    const previousTask = mentionQueues.get(channelId) || Promise.resolve();
    const queuedTask = previousTask.catch(() => {}).then(task);

    mentionQueues.set(channelId, queuedTask);
    queuedTask
        .finally(() => {
            if (mentionQueues.get(channelId) === queuedTask) {
                mentionQueues.delete(channelId);
            }
        })
        .catch(() => {});

    return queuedTask;
}

async function processMentionMessage(
    message: MentionMessage,
    channel: MentionChannel,
    clientId: string | undefined,
    deps: Partial<MentionDependencies>
): Promise<void> {
    const {
        buildMaidThinkingMessage = messageUtils.buildMaidThinkingMessage,
        sendSplitMessage = messageUtils.sendSplitMessage,
        generateResponse = ollamaClient.generateResponse,
        addToThreadHistory = threadManager.addToThreadHistory,
        getThreadHistory = threadManager.getThreadHistory
    } = deps;

    const channelId = channel.id;
    const prompt = extractMentionPrompt(message.content, clientId);

    logger.info('Handling mention response', {
        channelId,
        authorId: message.author?.id || null,
        messageLength: prompt.length
    });

    if (!prompt) {
        await sendSplitMessage(channel, EMPTY_MENTION_RESPONSE);
        return;
    }

    const history = getThreadHistory(channelId);
    addToThreadHistory(channelId, { role: 'user', text: prompt });

    try {
        const thinkingMsg = await channel.send(buildMaidThinkingMessage());
        const responseText = await generateResponse(prompt, history);

        addToThreadHistory(channelId, { role: 'assistant', text: responseText });
        await sendSplitMessage(channel, responseText, thinkingMsg);
        logger.info('Completed mention response', {
            channelId,
            responseLength: responseText.length
        });
    } catch (err) {
        logger.error('Error generating mention response', err, { channelId });
        await channel.send('エラーが発生しました。');
    }
}
