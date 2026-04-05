const threadHistory = new Map();

function cloneMessage(message) {
    return { ...message };
}

function cloneHistory(history = []) {
    return history.map(cloneMessage);
}

export function getThreadHistory(threadId) {
    return cloneHistory(threadHistory.get(threadId) || []);
}

export function setThreadHistory(threadId, history) {
    threadHistory.set(threadId, cloneHistory(history));
}

export function addToThreadHistory(threadId, message) {
    const history = [...getThreadHistory(threadId), cloneMessage(message)];
    setThreadHistory(threadId, history);
    return cloneHistory(history);
}

export function initializeThread(threadId, initialMessage) {
    const history = initialMessage ? [{ role: 'user', text: initialMessage }] : [];
    setThreadHistory(threadId, history);
    return cloneHistory(history);
}

export function clearThreadHistory(threadId) {
    threadHistory.delete(threadId);
}

export function getAllThreadIds() {
    return Array.from(threadHistory.keys());
}
