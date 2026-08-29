import type { AttachmentLike, AttachmentLoadResult } from '../attachmentLoader.ts';
import {
    composePromptWithAttachment,
    createAttachmentHistoryText,
    loadAttachmentText
} from '../attachmentLoader.ts';
import type {
    GenerationDetails,
    GenerationEntry,
    GenerationMessage
} from '../generationRegistry.ts';
import { completeGeneration, registerGeneration } from '../generationRegistry.ts';
import { createLogger } from '../logger.ts';
import { MANAGED_THREAD_STARTER_CONTENT, registerManagedThread } from '../managedThreadRegistry.ts';
import type { EditableMessage, SendableChannel } from '../messageUtils.ts';
import { buildMaidThinkingMessage, sendSplitMessage } from '../messageUtils.ts';
import { generateResponse, isResponseAbortedError } from '../ollamaClient.ts';
import { resolveSpeakerName } from '../speakerUtils.ts';
import type { HistoryEntry } from '../threadManager.ts';
import {
    addToThreadHistory,
    getThreadHistory,
    initializeThread,
    setThreadHistory
} from '../threadManager.ts';
import { generateThreadName } from '../threadNaming.ts';

const logger = createLogger('oCommand');

// デフォルトの依存関係
interface CommandThread extends SendableChannel {
    id: string;
    send(content: string | object): Promise<unknown>;
}

interface StarterMessage {
    startThread(options: { name: string; autoArchiveDuration: number }): Promise<CommandThread>;
}

export interface OCommandInteraction {
    options: {
        getString(name: string): string | null;
        getAttachment?(name: string): AttachmentLike | null;
    };
    user: { id?: string; username: string; globalName?: string | null };
    deferReply(): Promise<unknown>;
    followUp(content: string | object): Promise<StarterMessage>;
}

interface OCommandDependencies {
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
    getThreadHistory(threadId: string): HistoryEntry[];
    addToThreadHistory(threadId: string, entry: HistoryEntry): unknown;
    initializeThread(threadId: string, initialMessage?: string): unknown;
    generateThreadName(prompt: string, username: string): string;
    resolveSpeakerName(source: OCommandInteraction): string;
    loadAttachmentText(attachment: AttachmentLike): Promise<AttachmentLoadResult>;
    composePromptWithAttachment(
        prompt: string,
        attachment: Extract<AttachmentLoadResult, { ok: true }>
    ): string;
    createAttachmentHistoryText(
        prompt: string,
        attachment: Extract<AttachmentLoadResult, { ok: true }>
    ): string;
    setThreadHistory(threadId: string, history: readonly HistoryEntry[]): void;
    registerGeneration(threadId: string, details: GenerationDetails): GenerationEntry;
    completeGeneration(threadId: string, entry?: GenerationEntry): unknown;
    registerManagedThread(threadId: string): void;
}

const defaultDeps = {
    buildMaidThinkingMessage,
    sendSplitMessage,
    generateResponse,
    getThreadHistory,
    addToThreadHistory,
    initializeThread,
    generateThreadName,
    resolveSpeakerName,
    loadAttachmentText,
    composePromptWithAttachment,
    createAttachmentHistoryText,
    setThreadHistory,
    registerGeneration,
    completeGeneration,
    registerManagedThread
} satisfies OCommandDependencies;

export function createHandleOCommand(deps: Partial<OCommandDependencies> = {}) {
    const {
        buildMaidThinkingMessage: buildThinking,
        sendSplitMessage,
        generateResponse,
        getThreadHistory,
        addToThreadHistory,
        initializeThread,
        generateThreadName: nameThread,
        resolveSpeakerName,
        loadAttachmentText,
        composePromptWithAttachment,
        createAttachmentHistoryText,
        setThreadHistory,
        registerGeneration,
        completeGeneration,
        registerManagedThread: registerThread
    } = { ...defaultDeps, ...deps };

    return async function handleOCommand(interaction: OCommandInteraction): Promise<void> {
        const prompt = interaction.options.getString('prompt') ?? '';
        const attachment = interaction.options.getAttachment?.('file') || null;
        logger.info('Received /o command', {
            userId: interaction.user?.id || null,
            promptLength: prompt?.length || 0,
            hasAttachment: Boolean(attachment)
        });

        await interaction.deferReply();

        try {
            let responsePrompt = prompt;
            let historyPrompt = prompt;
            let attachmentName: string | null = null;
            if (attachment) {
                const result = await loadAttachmentText(attachment);
                if (!result.ok) {
                    await interaction.followUp({ content: result.message, ephemeral: true });
                    return;
                }

                responsePrompt = composePromptWithAttachment(prompt, result);
                historyPrompt = createAttachmentHistoryText(prompt, result);
                attachmentName = result.name;
            }

            const replyMsg = await interaction.followUp({
                content: MANAGED_THREAD_STARTER_CONTENT
            });

            const thread = await replyMsg.startThread({
                name: nameThread(prompt, interaction.user.username),
                autoArchiveDuration: 60
            });
            logger.info('Created response thread for /o command', {
                threadId: thread.id,
                userId: interaction.user?.id || null
            });

            registerThread(thread.id);
            initializeThread(thread.id);
            const history = getThreadHistory(thread.id);
            const speaker = resolveSpeakerName(interaction);
            addToThreadHistory(thread.id, { role: 'user', text: historyPrompt, speaker });

            const threadIntro = [
                `**プロンプト:** ${prompt}`,
                attachmentName && `📎 添付: ${attachmentName}`
            ]
                .filter(Boolean)
                .join('\n');
            await thread.send({ content: threadIntro, allowedMentions: { parse: [] } });

            await runCommandGeneration({
                thread,
                prompt: responsePrompt,
                history,
                speaker,
                userId: interaction.user?.id,
                buildThinking,
                sendSplitMessage,
                generateResponse,
                addToThreadHistory,
                getThreadHistory,
                setThreadHistory,
                registerGeneration,
                completeGeneration
            });
        } catch (err) {
            if (isResponseAbortedError(err)) return;
            logger.error('Error handling /o command', err, {
                userId: interaction.user?.id || null
            });
            await interaction
                .followUp({
                    content: 'エラーが発生しました。',
                    ephemeral: true
                })
                .catch(() => {});
        }
    };
}

// デフォルトのエクスポート（後方互換性）
export const handleOCommand = createHandleOCommand();

interface CommandGeneration {
    thread: CommandThread;
    prompt: string;
    history: readonly HistoryEntry[];
    speaker: string;
    userId?: string | undefined;
    buildThinking(): string;
    sendSplitMessage: OCommandDependencies['sendSplitMessage'];
    generateResponse: OCommandDependencies['generateResponse'];
    addToThreadHistory: OCommandDependencies['addToThreadHistory'];
    getThreadHistory: OCommandDependencies['getThreadHistory'];
    setThreadHistory: OCommandDependencies['setThreadHistory'];
    registerGeneration: OCommandDependencies['registerGeneration'];
    completeGeneration: OCommandDependencies['completeGeneration'];
}

async function runCommandGeneration(generation: CommandGeneration): Promise<void> {
    const thinkingMsg = await generation.thread.send(generation.buildThinking());
    if (
        typeof thinkingMsg !== 'object' ||
        thinkingMsg === null ||
        !('edit' in thinkingMsg) ||
        typeof thinkingMsg.edit !== 'function'
    ) {
        throw new Error('Thinking message does not support editing.');
    }
    // The structural check above establishes the editable message contract.
    const editableThinkingMsg = thinkingMsg as GenerationMessage &
        Required<Pick<GenerationMessage, 'edit'>>;
    await addGenerationReactions(editableThinkingMsg);

    const controller = new AbortController();
    const entry = generation.registerGeneration(generation.thread.id, {
        controller,
        thinkingMsg: editableThinkingMsg,
        userId: generation.userId
    });
    entry.regenerate = async () => {
        if (entry.state === 'completed') {
            const currentHistory = generation.getThreadHistory(generation.thread.id);
            if (currentHistory.at(-1)?.role === 'assistant') {
                generation.setThreadHistory(generation.thread.id, currentHistory.slice(0, -1));
            }
        }

        await runCommandGeneration(generation);
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

        generation.addToThreadHistory(generation.thread.id, {
            role: 'assistant',
            text: responseText
        });
        await generation.sendSplitMessage(generation.thread, responseText, editableThinkingMsg);
        generation.completeGeneration(generation.thread.id, entry);
        logger.info('Completed /o command response', {
            threadId: generation.thread.id,
            responseLength: responseText.length
        });
    } catch (err) {
        if (isResponseAbortedError(err) || controller.signal.aborted) {
            await showGenerationStopped(
                editableThinkingMsg,
                entry.abortMessage || '✖️ 中断しました。'
            );
            return;
        }

        generation.completeGeneration(generation.thread.id, entry);
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
