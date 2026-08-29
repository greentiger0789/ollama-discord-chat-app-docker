export type ConversationRole = 'user' | 'assistant';

export interface HistoryEntry {
    role: ConversationRole;
    text: string;
    speaker?: string;
}

const threadHistory = new Map<string, HistoryEntry[]>();

function cloneMessage(message: HistoryEntry): HistoryEntry {
    return { ...message };
}

function cloneHistory(history: readonly HistoryEntry[] = []): HistoryEntry[] {
    return history.map(cloneMessage);
}

export function getThreadHistory(threadId: string): HistoryEntry[] {
    return cloneHistory(threadHistory.get(threadId) || []);
}

export function setThreadHistory(threadId: string, history: readonly HistoryEntry[]): void {
    threadHistory.set(threadId, cloneHistory(history));
}

export function addToThreadHistory(threadId: string, message: HistoryEntry): HistoryEntry[] {
    const history = [...getThreadHistory(threadId), cloneMessage(message)];
    setThreadHistory(threadId, history);
    return cloneHistory(history);
}

export function initializeThread(threadId: string, initialMessage?: string): HistoryEntry[] {
    const history: HistoryEntry[] = initialMessage ? [{ role: 'user', text: initialMessage }] : [];
    setThreadHistory(threadId, history);
    return cloneHistory(history);
}

export function clearThreadHistory(threadId: string): void {
    threadHistory.delete(threadId);
}

export function getAllThreadIds(): string[] {
    return Array.from(threadHistory.keys());
}
