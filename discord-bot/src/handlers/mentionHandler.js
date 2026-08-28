import { createLogger } from '../logger.js';
import * as messageUtils from '../messageUtils.js';
import * as ollamaClient from '../ollamaClient.js';
import * as threadManager from '../threadManager.js';

const logger = createLogger('mentionHandler');
const mentionQueues = new Map();

export const EMPTY_MENTION_RESPONSE = 'ご主人様、なにかご用でしょうか？';

export function extractMentionPrompt(content, clientId) {
    if (!content || !clientId) return '';

    const escapedClientId = String(clientId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return String(content)
        .replaceAll(new RegExp(`<@!?${escapedClientId}>`, 'g'), '')
        .trim();
}

function isMentioningClient(message, clientId) {
    if (!clientId) return false;

    return (
        message.mentions?.users?.has?.(clientId) ||
        message.mentions?.has?.(clientId) ||
        message.content?.includes(`<@${clientId}>`) ||
        message.content?.includes(`<@!${clientId}>`)
    );
}

export async function handleMentionMessage(message, deps = {}) {
    const channel = message.channel;
    if (!channel || channel.isThread?.()) return;
    if (message.author?.bot) return;

    const clientId = deps.clientId ?? message.client?.user?.id;
    if (!isMentioningClient(message, clientId)) return;
    if (!channel.id) return;

    return await enqueueMentionTask(channel.id, () =>
        processMentionMessage(message, clientId, deps)
    );
}

function enqueueMentionTask(channelId, task) {
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

async function processMentionMessage(message, clientId, deps) {
    const {
        buildMaidThinkingMessage = messageUtils.buildMaidThinkingMessage,
        sendSplitMessage = messageUtils.sendSplitMessage,
        generateResponse = ollamaClient.generateResponse,
        addToThreadHistory = threadManager.addToThreadHistory,
        getThreadHistory = threadManager.getThreadHistory
    } = deps;

    const channelId = message.channel.id;
    const prompt = extractMentionPrompt(message.content, clientId);

    logger.info('Handling mention response', {
        channelId,
        authorId: message.author?.id || null,
        messageLength: prompt.length
    });

    if (!prompt) {
        await sendSplitMessage(message.channel, EMPTY_MENTION_RESPONSE);
        return;
    }

    const history = getThreadHistory(channelId);
    addToThreadHistory(channelId, { role: 'user', text: prompt });

    try {
        const thinkingMsg = await message.channel.send(buildMaidThinkingMessage());
        const responseText = await generateResponse(prompt, history);

        addToThreadHistory(channelId, { role: 'assistant', text: responseText });
        await sendSplitMessage(message.channel, responseText, thinkingMsg);
        logger.info('Completed mention response', {
            channelId,
            responseLength: responseText.length
        });
    } catch (err) {
        logger.error('Error generating mention response', err, { channelId });
        await message.channel.send('エラーが発生しました。');
    }
}
