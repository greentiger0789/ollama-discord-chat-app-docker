import { clearGeneration } from '../generationRegistry.js';
import { createLogger } from '../logger.js';
import { isManagedThread } from '../managedThreadRegistry.js';
import { clearThreadHistory } from '../threadManager.js';

const logger = createLogger('resetCommand');

const defaultDeps = {
    clearThreadHistory,
    clearGeneration,
    isManagedThread
};

export function createHandleOResetCommand(deps = defaultDeps) {
    const {
        clearThreadHistory: clearHistory,
        clearGeneration,
        isManagedThread: checkManagedThread
    } = { ...defaultDeps, ...deps };

    return async function handleOResetCommand(interaction) {
        if (!interaction.channel?.isThread?.()) {
            await interaction.reply({
                content: 'このコマンドはスレッド内でのみ使用できます。',
                ephemeral: true
            });
            return;
        }

        const managed = await checkManagedThread(interaction.channel, {
            clientId: interaction.client?.user?.id
        });
        if (!managed) {
            await interaction.reply({
                content: 'このコマンドは /o で作成したスレッド内でのみ使用できます。',
                ephemeral: true
            });
            return;
        }

        const threadId = interaction.channel.id;

        try {
            clearGeneration(threadId);
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
