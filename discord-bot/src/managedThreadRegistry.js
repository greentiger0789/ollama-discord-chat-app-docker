import { createLogger } from './logger.js';

export const MANAGED_THREAD_STARTER_CONTENT = 'スレッドを作成しました';

const logger = createLogger('managedThreadRegistry');
const managedThreadIds = new Set();
const unmanagedThreadIds = new Set();
const pendingClassifications = new Map();

export function registerManagedThread(threadId) {
    if (!threadId) return;

    managedThreadIds.add(threadId);
    unmanagedThreadIds.delete(threadId);
}

export function isRegisteredManagedThread(threadId) {
    return Boolean(threadId) && managedThreadIds.has(threadId);
}

export async function isManagedThread(channel, { clientId } = {}) {
    const threadId = channel?.id;
    if (!threadId) return false;
    if (managedThreadIds.has(threadId)) return true;
    if (unmanagedThreadIds.has(threadId)) return false;

    const resolvedClientId = clientId ?? channel.client?.user?.id;
    if (!resolvedClientId) return false;

    if (channel.ownerId !== resolvedClientId) {
        unmanagedThreadIds.add(threadId);
        return false;
    }

    const pending = pendingClassifications.get(threadId);
    if (pending) return await pending;

    const classification = classifyThreadFromStarterMessage(channel, resolvedClientId);
    pendingClassifications.set(threadId, classification);

    try {
        return await classification;
    } finally {
        if (pendingClassifications.get(threadId) === classification) {
            pendingClassifications.delete(threadId);
        }
    }
}

async function classifyThreadFromStarterMessage(channel, clientId) {
    const threadId = channel.id;
    if (typeof channel.fetchStarterMessage !== 'function') {
        unmanagedThreadIds.add(threadId);
        return false;
    }

    try {
        const starterMessage = await channel.fetchStarterMessage();
        const managed =
            starterMessage?.author?.id === clientId &&
            starterMessage.content === MANAGED_THREAD_STARTER_CONTENT;

        if (managed) {
            managedThreadIds.add(threadId);
        } else {
            unmanagedThreadIds.add(threadId);
        }

        return managed;
    } catch (err) {
        logger.warn('Failed to verify managed thread from starter message', err, { threadId });
        return false;
    }
}
