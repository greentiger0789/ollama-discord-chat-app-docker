const threadHistory = new Map();

export function getThreadHistory(threadId) {
    return threadHistory.get(threadId) || [];
}

export function setThreadHistory(threadId, history) {
    threadHistory.set(threadId, history);
}

export function addToThreadHistory(threadId, message) {
    const history = getThreadHistory(threadId);
    history.push(message);
    setThreadHistory(threadId, history);
    return history;
}

export function initializeThread(threadId, initialMessage) {
    const history = [{ role: 'user', text: initialMessage }];
    setThreadHistory(threadId, history);
    return history;
}

export function clearThreadHistory(threadId) {
    threadHistory.delete(threadId);
}

export function getAllThreadIds() {
    return Array.from(threadHistory.keys());
}
