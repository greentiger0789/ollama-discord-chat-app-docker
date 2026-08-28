const generationsByThread = new Map();
const generationsByMessage = new Map();

function removeGeneration(entry) {
    if (!entry) return null;

    if (generationsByThread.get(entry.threadId) === entry) {
        generationsByThread.delete(entry.threadId);
    }
    if (generationsByMessage.get(entry.thinkingMsg?.id) === entry) {
        generationsByMessage.delete(entry.thinkingMsg.id);
    }

    return entry;
}

export function registerGeneration(threadId, details) {
    const previous = generationsByThread.get(threadId);
    removeGeneration(previous);

    const entry = {
        ...details,
        threadId,
        state: 'generating'
    };
    generationsByThread.set(threadId, entry);
    if (entry.thinkingMsg?.id) {
        generationsByMessage.set(entry.thinkingMsg.id, entry);
    }

    return entry;
}

export function getGenerationByThread(threadId) {
    return generationsByThread.get(threadId) || null;
}

export function getGenerationByThinkingMessage(messageId) {
    return generationsByMessage.get(messageId) || null;
}

export function takeGenerationByThinkingMessage(messageId) {
    const entry = getGenerationByThinkingMessage(messageId);
    return removeGeneration(entry);
}

export function cancelGeneration(threadId) {
    const entry = getGenerationByThread(threadId);
    if (entry?.state !== 'generating') return null;

    removeGeneration(entry);
    entry.controller.abort();
    return entry;
}

export function clearGeneration(threadId) {
    const entry = removeGeneration(getGenerationByThread(threadId));
    if (entry?.state === 'generating') {
        entry.controller.abort();
    }
    return entry;
}

export function completeGeneration(threadId, entry) {
    const current = getGenerationByThread(threadId);
    if (!current || (entry && current !== entry)) return null;

    current.state = 'completed';
    return current;
}

export function clearCompletedGeneration(threadId) {
    const entry = getGenerationByThread(threadId);
    if (entry?.state === 'completed') {
        removeGeneration(entry);
    }
}
