import {
    getGenerationByThinkingMessage as defaultGetGenerationByThinkingMessage,
    takeGenerationByThinkingMessage as defaultTakeGenerationByThinkingMessage
} from '../generationRegistry.js';

const CONTROL_EMOJIS = new Set(['❌', '🔄']);

export function createHandleReactionAdd(deps = {}) {
    const {
        getGenerationByThinkingMessage = defaultGetGenerationByThinkingMessage,
        takeGenerationByThinkingMessage = defaultTakeGenerationByThinkingMessage
    } = deps;

    return async function handleReactionAdd(reaction, user) {
        const emoji = reaction.emoji?.name;
        if (user?.bot || !CONTROL_EMOJIS.has(emoji)) return;

        const resolvedReaction = await resolveReaction(reaction);
        if (!resolvedReaction) return;

        const message = await resolveMessage(resolvedReaction.message);
        if (!message?.channel?.isThread?.()) return;

        const generation = getGenerationByThinkingMessage(message.id);
        if (!generation || (generation.userId && generation.userId !== user.id)) return;
        if (emoji === '❌' && generation.state !== 'generating') return;

        // get と delete を同じイベントループ内で連続して行い、同時操作を一度だけ受け付ける。
        const claimed = takeGenerationByThinkingMessage(message.id);
        if (!claimed) return;

        if (emoji === '❌') {
            claimed.controller.abort();
            return;
        }

        claimed.abortMessage = '🔄 再生成しました。';
        if (claimed.state === 'generating') {
            claimed.controller.abort();
        }
        await claimed.regenerate?.();
    };
}

async function resolveReaction(reaction) {
    if (!reaction.partial) return reaction;

    try {
        return await reaction.fetch();
    } catch {
        return null;
    }
}

async function resolveMessage(message) {
    if (!message?.partial) return message;

    try {
        return await message.fetch();
    } catch {
        return null;
    }
}

export const handleReactionAdd = createHandleReactionAdd();
