import { createLogger } from '../logger.js';
import { buildMaidThinkingMessage, sendSplitMessage } from '../messageUtils.js';
import { summarizeConversation } from '../ollamaClient.js';
import { getThreadHistory } from '../threadManager.js';

const logger = createLogger('summaryCommand');

const defaultDeps = {
    getThreadHistory,
    summarizeConversation,
    sendSplitMessage,
    buildMaidThinkingMessage
};

export function createHandleOSummaryCommand(deps = defaultDeps) {
    const {
        getThreadHistory: getHistory,
        summarizeConversation: summarize,
        sendSplitMessage,
        buildMaidThinkingMessage: buildThinking
    } = { ...defaultDeps, ...deps };

    return async function handleOSummaryCommand(interaction) {
        if (!interaction.channel?.isThread?.()) {
            await interaction.reply({
                content: 'このコマンドはスレッド内でのみ使用できます。',
                ephemeral: true
            });
            return;
        }

        const threadId = interaction.channel.id;
        const history = getHistory(threadId);

        if (!history.length) {
            await interaction.reply({
                content: 'まだ会話がありません、ご主人様。',
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply();

        try {
            const thinkingMsg = await interaction.channel.send(buildThinking());

            const summary = await summarize(history);

            await sendSplitMessage(interaction.channel, summary, thinkingMsg);
            // deferReply を確定させる（未解決のままにすると「考え中...」が残り続ける）
            await interaction.deleteReply().catch(() => {});
            logger.info('Completed thread summary', {
                threadId,
                historyLength: history.length,
                summaryLength: summary.length,
                userId: interaction.user?.id || null
            });
        } catch (err) {
            logger.error('Error summarizing thread conversation', err, {
                threadId,
                userId: interaction.user?.id || null
            });
            await interaction
                .followUp({
                    content: '要約の生成中にエラーが発生しました。',
                    ephemeral: true
                })
                .catch(() => {});
        }
    };
}

// デフォルトのエクスポート（後方互換性）
export const handleOSummaryCommand = createHandleOSummaryCommand();
