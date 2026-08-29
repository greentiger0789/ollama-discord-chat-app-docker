import {
    getGenerationByThinkingMessage as defaultGetGenerationByThinkingMessage,
    takeGenerationByThinkingMessage as defaultTakeGenerationByThinkingMessage
} from '../generationRegistry.ts';

const CONTROL_EMOJIS = new Set(['❌', '🔄']);

interface ReactionMessage {
    id?: string;
    partial?: boolean;
    channel?: { isThread?(): boolean };
    fetch?(): Promise<ReactionMessage>;
}

export interface ReactionLike {
    emoji?: { name?: string | null };
    partial?: boolean;
    message?: ReactionMessage;
    fetch?(): Promise<ReactionLike>;
}

export interface ReactionUser {
    id: string;
    bot?: boolean;
}

export interface ReactionGeneration {
    state: 'generating' | 'completed';
    controller?: AbortController;
    userId?: string;
    abortMessage?: string;
    regenerate?(): Promise<void>;
}

export interface ReactionDependencies {
    getGenerationByThinkingMessage(messageId: string): ReactionGeneration | null;
    takeGenerationByThinkingMessage(messageId: string): ReactionGeneration | null;
}

export function createHandleReactionAdd(deps: Partial<ReactionDependencies> = {}) {
    const {
        getGenerationByThinkingMessage = defaultGetGenerationByThinkingMessage,
        takeGenerationByThinkingMessage = defaultTakeGenerationByThinkingMessage
    } = deps;

    return async function handleReactionAdd(
        reaction: ReactionLike,
        user: ReactionUser
    ): Promise<void> {
        const emoji = reaction.emoji?.name;
        if (user?.bot || !emoji || !CONTROL_EMOJIS.has(emoji)) return;

        const resolvedReaction = await resolveReaction(reaction);
        if (!resolvedReaction) return;

        const message = await resolveMessage(resolvedReaction.message);
        if (!message?.channel?.isThread?.()) return;

        if (!message.id) return;
        const generation = getGenerationByThinkingMessage(message.id);
        if (!generation || (generation.userId && generation.userId !== user.id)) return;
        if (emoji === '❌' && generation.state !== 'generating') return;

        // get と delete を同じイベントループ内で連続して行い、同時操作を一度だけ受け付ける。
        const claimed = takeGenerationByThinkingMessage(message.id);
        if (!claimed) return;

        if (emoji === '❌') {
            claimed.controller?.abort();
            return;
        }

        claimed.abortMessage = '🔄 再生成しました。';
        if (claimed.state === 'generating') {
            claimed.controller?.abort();
        }
        await claimed.regenerate?.();
    };
}

async function resolveReaction(reaction: ReactionLike): Promise<ReactionLike | null> {
    if (!reaction.partial) return reaction;

    try {
        return reaction.fetch ? await reaction.fetch() : null;
    } catch {
        return null;
    }
}

async function resolveMessage(
    message: ReactionMessage | undefined
): Promise<ReactionMessage | null> {
    if (!message?.partial) return message ?? null;

    try {
        return message.fetch ? await message.fetch() : null;
    } catch {
        return null;
    }
}

export const handleReactionAdd = createHandleReactionAdd();
