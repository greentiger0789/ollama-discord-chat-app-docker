export type GenerationState = 'generating' | 'completed';

export interface GenerationMessage {
    id?: string;
    edit?(content: string): Promise<unknown>;
    react?(emoji: string): Promise<unknown>;
    reactions?: {
        removeAll?(): Promise<unknown>;
    };
}

export interface GenerationDetails {
    controller: AbortController;
    thinkingMsg: GenerationMessage;
    userId?: string | undefined;
    regenerate?: (() => Promise<void>) | undefined;
    abortMessage?: string | undefined;
}

export interface GenerationEntry extends GenerationDetails {
    threadId: string;
    state: GenerationState;
}

const generationsByThread = new Map<string, GenerationEntry>();
const generationsByMessage = new Map<string, GenerationEntry>();

function removeGeneration(entry: GenerationEntry | null | undefined): GenerationEntry | null {
    if (!entry) return null;

    if (generationsByThread.get(entry.threadId) === entry) {
        generationsByThread.delete(entry.threadId);
    }
    const thinkingMessageId = entry.thinkingMsg.id;
    if (thinkingMessageId && generationsByMessage.get(thinkingMessageId) === entry) {
        generationsByMessage.delete(thinkingMessageId);
    }

    return entry;
}

export function registerGeneration(threadId: string, details: GenerationDetails): GenerationEntry {
    const previous = generationsByThread.get(threadId);
    removeGeneration(previous);

    const entry: GenerationEntry = {
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

export function getGenerationByThread(threadId: string): GenerationEntry | null {
    return generationsByThread.get(threadId) || null;
}

export function getGenerationByThinkingMessage(messageId: string): GenerationEntry | null {
    return generationsByMessage.get(messageId) || null;
}

export function takeGenerationByThinkingMessage(messageId: string): GenerationEntry | null {
    const entry = getGenerationByThinkingMessage(messageId);
    return removeGeneration(entry);
}

export function cancelGeneration(threadId: string): GenerationEntry | null {
    const entry = getGenerationByThread(threadId);
    if (entry?.state !== 'generating') return null;

    removeGeneration(entry);
    entry.controller.abort();
    return entry;
}

export function clearGeneration(threadId: string): GenerationEntry | null {
    const entry = removeGeneration(getGenerationByThread(threadId));
    if (entry?.state === 'generating') {
        entry.controller.abort();
    }
    return entry;
}

export function completeGeneration(
    threadId: string,
    entry?: GenerationEntry
): GenerationEntry | null {
    const current = getGenerationByThread(threadId);
    if (!current || (entry && current !== entry)) return null;

    current.state = 'completed';
    return current;
}

export function clearCompletedGeneration(threadId: string): void {
    const entry = getGenerationByThread(threadId);
    if (entry?.state === 'completed') {
        removeGeneration(entry);
    }
}
