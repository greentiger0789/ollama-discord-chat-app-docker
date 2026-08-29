import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
    isManagedThread,
    isRegisteredManagedThread,
    MANAGED_THREAD_STARTER_CONTENT,
    registerManagedThread
} from '../src/managedThreadRegistry.js';

const CLIENT_ID = 'maid-1';

function createThread({ id, ownerId = CLIENT_ID, starterAuthorId = CLIENT_ID, content } = {}) {
    let fetchCount = 0;
    const channel = {
        id,
        ownerId,
        fetchStarterMessage: async () => {
            fetchCount++;
            return {
                author: { id: starterAuthorId },
                content: content ?? MANAGED_THREAD_STARTER_CONTENT
            };
        }
    };

    return { channel, getFetchCount: () => fetchCount };
}

describe('managedThreadRegistry', () => {
    test('accepts explicitly registered /o threads without fetching Discord state', async () => {
        const threadId = 'registered-thread';
        registerManagedThread(threadId);

        const { channel, getFetchCount } = createThread({ id: threadId, ownerId: 'other-user' });

        assert.equal(await isManagedThread(channel, { clientId: CLIENT_ID }), true);
        assert.equal(isRegisteredManagedThread(threadId), true);
        assert.equal(getFetchCount(), 0);
    });

    test('rejects threads not owned by Maid-chan without fetching the starter message', async () => {
        const { channel, getFetchCount } = createThread({
            id: 'human-owned-thread',
            ownerId: 'human-1'
        });

        assert.equal(await isManagedThread(channel, { clientId: CLIENT_ID }), false);
        assert.equal(getFetchCount(), 0);
    });

    test('restores a managed thread from its bot-authored starter message and caches it', async () => {
        const { channel, getFetchCount } = createThread({ id: 'restored-thread' });

        assert.equal(await isManagedThread(channel, { clientId: CLIENT_ID }), true);
        assert.equal(await isManagedThread(channel, { clientId: CLIENT_ID }), true);
        assert.equal(isRegisteredManagedThread(channel.id), true);
        assert.equal(getFetchCount(), 1);
    });

    test('coalesces concurrent starter-message checks for the same thread', async () => {
        const { channel, getFetchCount } = createThread({ id: 'concurrent-restored-thread' });

        const results = await Promise.all([
            isManagedThread(channel, { clientId: CLIENT_ID }),
            isManagedThread(channel, { clientId: CLIENT_ID })
        ]);

        assert.deepEqual(results, [true, true]);
        assert.equal(getFetchCount(), 1);
    });

    test('retries classification when the client id was temporarily unavailable', async () => {
        const { channel, getFetchCount } = createThread({ id: 'missing-client-id-thread' });

        assert.equal(await isManagedThread(channel), false);
        assert.equal(await isManagedThread(channel, { clientId: CLIENT_ID }), true);
        assert.equal(getFetchCount(), 1);
    });

    for (const [name, options] of [
        ['a starter message from another author', { starterAuthorId: 'human-1' }],
        ['a starter message without the /o marker', { content: '別のBot用スレッドです' }]
    ]) {
        test(`rejects ${name}`, async () => {
            const { channel } = createThread({ id: `invalid-${name}`, ...options });

            assert.equal(await isManagedThread(channel, { clientId: CLIENT_ID }), false);
            assert.equal(isRegisteredManagedThread(channel.id), false);
        });
    }

    test('fails closed but retries when fetching the starter message fails', async () => {
        let fetchCount = 0;
        const channel = {
            id: 'temporarily-unavailable-thread',
            ownerId: CLIENT_ID,
            fetchStarterMessage: async () => {
                fetchCount++;
                if (fetchCount === 1) throw new Error('temporary Discord API failure');
                return {
                    author: { id: CLIENT_ID },
                    content: MANAGED_THREAD_STARTER_CONTENT
                };
            }
        };

        assert.equal(await isManagedThread(channel, { clientId: CLIENT_ID }), false);
        assert.equal(await isManagedThread(channel, { clientId: CLIENT_ID }), true);
        assert.equal(fetchCount, 2);
    });
});
