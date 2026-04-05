import * as messageUtils from '../messageUtils.js';
import * as ollamaClient from '../ollamaClient.js';
import * as threadManager from '../threadManager.js';

export async function handleThreadMessage(message, deps = {}) {
    const {
        buildMaidThinkingMessage = messageUtils.buildMaidThinkingMessage,
        sendSplitMessage = messageUtils.sendSplitMessage,
        generateResponse = ollamaClient.generateResponse,
        addToThreadHistory = threadManager.addToThreadHistory,
        getThreadHistory = threadManager.getThreadHistory
    } = deps;

    if (!message.channel.isThread()) return;
    if (message.author.bot) return;

    const threadId = message.channel.id;
    const history = getThreadHistory(threadId);

    addToThreadHistory(threadId, {
        role: 'user',
        text: message.content
    });

    try {
        const thinkingMsg = await message.channel.send(buildMaidThinkingMessage());

        const responseText = await generateResponse(message.content, history);

        addToThreadHistory(threadId, {
            role: 'assistant',
            text: responseText
        });

        await sendSplitMessage(message.channel, responseText, thinkingMsg);
    } catch (err) {
        console.error('Error generating follow-up', err);
        await message.channel.send('エラーが発生しました。');
    }
}
