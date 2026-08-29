import { clearGeneration } from '../generationRegistry.ts';
import { createLogger } from '../logger.ts';
import type { ManagedThreadChannel } from '../managedThreadRegistry.ts';
import { isManagedThread } from '../managedThreadRegistry.ts';
import { clearThreadHistory } from '../threadManager.ts';

const logger = createLogger('resetCommand');

interface ResetChannel extends ManagedThreadChannel {
    id: string;
    isThread?(): boolean;
}

export interface ResetInteraction {
    channel?: ResetChannel | null;
    client?: { user?: { id?: string } | null };
    user?: { id?: string };
    reply(content: CommandReply): Promise<unknown>;
}

export interface CommandReply {
    content: string;
    ephemeral?: boolean;
}

interface ResetDependencies {
    clearThreadHistory(threadId: string): void;
    clearGeneration(threadId: string): unknown;
    isManagedThread(
        channel: ManagedThreadChannel,
        options?: { clientId?: string | undefined }
    ): Promise<boolean>;
}

const defaultDeps = {
    clearThreadHistory,
    clearGeneration,
    isManagedThread
} satisfies ResetDependencies;

export function createHandleOResetCommand(deps: Partial<ResetDependencies> = {}) {
    const {
        clearThreadHistory: clearHistory,
        clearGeneration,
        isManagedThread: checkManagedThread
    } = { ...defaultDeps, ...deps };

    return async function handleOResetCommand(interaction: ResetInteraction): Promise<void> {
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
