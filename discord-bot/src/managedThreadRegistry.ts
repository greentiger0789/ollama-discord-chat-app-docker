import { createLogger } from './logger.ts';

export const MANAGED_THREAD_STARTER_CONTENT = 'スレッドを作成しました';

const logger = createLogger('managedThreadRegistry');
const managedThreadIds = new Set<string>();
const unmanagedThreadIds = new Set<string>();
const pendingClassifications = new Map<string, Promise<boolean>>();

export interface ManagedThreadChannel {
    id?: string | undefined;
    ownerId?: string | null | undefined;
    client?: { user?: { id?: string } | null } | undefined;
    fetchStarterMessage?:
        | (() => Promise<{
              author?: { id?: string } | null;
              content?: string | null;
          } | null>)
        | undefined;
}

export interface ManagedThreadOptions {
    clientId?: string | undefined;
}

export function registerManagedThread(threadId: string | null | undefined): void {
    if (!threadId) return;

    managedThreadIds.add(threadId);
    unmanagedThreadIds.delete(threadId);
}

export function isRegisteredManagedThread(threadId: string | null | undefined): boolean {
    return threadId ? managedThreadIds.has(threadId) : false;
}

export async function isManagedThread(
    channel: ManagedThreadChannel | null | undefined,
    { clientId }: ManagedThreadOptions = {}
): Promise<boolean> {
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

    const classification = classifyThreadFromStarterMessage(
        { ...channel, id: threadId },
        resolvedClientId
    );
    pendingClassifications.set(threadId, classification);

    try {
        return await classification;
    } finally {
        if (pendingClassifications.get(threadId) === classification) {
            pendingClassifications.delete(threadId);
        }
    }
}

async function classifyThreadFromStarterMessage(
    channel: ManagedThreadChannel & { id: string },
    clientId: string
): Promise<boolean> {
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
