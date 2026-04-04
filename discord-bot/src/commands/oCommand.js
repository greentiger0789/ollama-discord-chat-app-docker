import { buildMaidThinkingMessage, sendSplitMessage } from '../messageUtils.js';
import { generateResponse } from '../ollamaClient.js';
import { addToThreadHistory, getThreadHistory, initializeThread } from '../threadManager.js';

// デフォルトの依存関係
const defaultDeps = {
    buildMaidThinkingMessage,
    sendSplitMessage,
    generateResponse,
    getThreadHistory,
    addToThreadHistory,
    initializeThread,
};

export function createHandleOCommand(deps = defaultDeps) {
    const {
        buildMaidThinkingMessage: buildThinking,
        sendSplitMessage,
        generateResponse,
        getThreadHistory,
        addToThreadHistory,
        initializeThread,
    } = { ...defaultDeps, ...deps };

    return async function handleOCommand(interaction) {
        const prompt = interaction.options.getString('prompt');

        await interaction.deferReply();

        try {
            const replyMsg = await interaction.followUp({
                content: 'スレッドを作成しました'
            });

            const thread = await replyMsg.startThread({
                name: `o-${interaction.user.username}-${Date.now() % 10000}`,
                autoArchiveDuration: 60
            });

            initializeThread(thread.id);
            const history = getThreadHistory(thread.id);
            addToThreadHistory(thread.id, { role: 'user', text: prompt });

            await thread.send(`**プロンプト:** ${prompt}`);

            const thinkingMsg = await thread.send(buildThinking());

            const responseText = await generateResponse(
                prompt,
                history
            );

            addToThreadHistory(thread.id, { role: 'assistant', text: responseText });

            await sendSplitMessage(thread, responseText, thinkingMsg);

        } catch (err) {
            console.error('Error handling /o command', err);
            await interaction.followUp({
                content: 'エラーが発生しました。',
                ephemeral: true
            }).catch(() => { });
        }
    };
}

// デフォルトのエクスポート（後方互換性）
export const handleOCommand = createHandleOCommand();
