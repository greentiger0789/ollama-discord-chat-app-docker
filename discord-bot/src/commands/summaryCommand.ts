import { createLogger } from '../logger.ts';
import type { ManagedThreadChannel } from '../managedThreadRegistry.ts';
import { isManagedThread } from '../managedThreadRegistry.ts';
import type { EditableMessage, SendableChannel } from '../messageUtils.ts';
import { buildMaidThinkingMessage, sendSplitMessage } from '../messageUtils.ts';
import { summarizeConversation } from '../ollamaClient.ts';
import type { HistoryEntry } from '../threadManager.ts';
import { getThreadHistory } from '../threadManager.ts';
import type { CommandReply } from './resetCommand.ts';

const logger = createLogger('summaryCommand');

interface SummaryChannel extends ManagedThreadChannel {
    id: string;
    isThread?(): boolean;
    send?(content: string | object): Promise<EditableMessage>;
}

export interface SummaryInteraction {
    channel?: SummaryChannel | null;
    client?: { user?: { id?: string } | null };
    user?: { id?: string };
    reply(content: CommandReply): Promise<unknown>;
    deferReply(): Promise<unknown>;
    deleteReply?(): Promise<unknown>;
    followUp?(content: CommandReply): Promise<unknown>;
}

interface SummaryDependencies {
    getThreadHistory(threadId: string): HistoryEntry[];
    summarizeConversation(history: readonly HistoryEntry[]): Promise<string | null>;
    sendSplitMessage(
        channel: SendableChannel,
        text: string,
        firstMessageToEdit?: EditableMessage | null
    ): Promise<void>;
    buildMaidThinkingMessage(): string;
    isManagedThread(
        channel: ManagedThreadChannel,
        options?: { clientId?: string | undefined }
    ): Promise<boolean>;
}

const defaultDeps = {
    getThreadHistory,
    summarizeConversation,
    sendSplitMessage,
    buildMaidThinkingMessage,
    isManagedThread
} satisfies SummaryDependencies;

export function createHandleOSummaryCommand(deps: Partial<SummaryDependencies> = {}) {
    const {
        getThreadHistory: getHistory,
        summarizeConversation: summarize,
        sendSplitMessage,
        buildMaidThinkingMessage: buildThinking,
        isManagedThread: checkManagedThread
    } = { ...defaultDeps, ...deps };

    return async function handleOSummaryCommand(interaction: SummaryInteraction): Promise<void> {
        const channel = interaction.channel;
        if (!channel?.isThread?.()) {
            await interaction.reply({
                content: 'このコマンドはスレッド内でのみ使用できます。',
                ephemeral: true
            });
            return;
        }

        const managed = await checkManagedThread(channel, {
            clientId: interaction.client?.user?.id
        });
        if (!managed) {
            await interaction.reply({
                content: 'このコマンドは /o で作成したスレッド内でのみ使用できます。',
                ephemeral: true
            });
            return;
        }

        if (!channel.send) {
            await interaction.reply({
                content: 'このコマンドはスレッド内でのみ使用できます。',
                ephemeral: true
            });
            return;
        }

        const threadId = channel.id;
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
            const thinkingMsg = await channel.send(buildThinking());

            const summary = await summarize(history);
            if (summary === null) {
                throw new Error('Summary response did not contain text.');
            }

            // channel.send was checked before history processing, establishing this narrower port.
            await sendSplitMessage(channel as SendableChannel, summary, thinkingMsg);
            // deferReply を確定させる（未解決のままにすると「考え中...」が残り続ける）
            await interaction.deleteReply?.().catch(() => {});
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
                .followUp?.({
                    content: '要約の生成中にエラーが発生しました。',
                    ephemeral: true
                })
                .catch(() => {});
        }
    };
}

// デフォルトのエクスポート（後方互換性）
export const handleOSummaryCommand = createHandleOSummaryCommand();
