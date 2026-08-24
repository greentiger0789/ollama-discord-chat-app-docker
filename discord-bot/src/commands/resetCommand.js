import { createLogger } from '../logger.js';
import { clearThreadHistory } from '../threadManager.js';

const logger = createLogger('resetCommand');

const defaultDeps = {
    clearThreadHistory
};

export function createHandleOResetCommand(deps = defaultDeps) {
    const { clearThreadHistory: clearHistory } = { ...defaultDeps, ...deps };

    return async function handleOResetCommand(interaction) {
        if (!interaction.channel?.isThread?.()) {
            await interaction.reply({
                content: 'このコマンドはスレッド内でのみ使用できます。',
                ephemeral: true
            });
            return;
        }

        const threadId = interaction.channel.id;

        try {
            clearHistory(threadId);
            logger.info('Cleared thread history', {
                threadId,
                userId: interaction.user?.id || null
            });
            await interaction.reply({
                content: '会話履歴をリセットしました、ご主人様♡'
            });
        } catch (err) {
            logger.error('Error resetting thread history', err, {
                threadId,
                userId: interaction.user?.id || null
            });
            await interaction
                .reply({
                    content: 'エラーが発生しました。',
                    ephemeral: true
                })
                .catch(() => {});
        }
    };
}

// デフォルトのエクスポート（後方互換性）
export const handleOResetCommand = createHandleOResetCommand();
