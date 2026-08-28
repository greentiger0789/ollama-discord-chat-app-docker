import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

async function importFreshThreadManager() {
    const modulePath = new URL('../src/threadManager.js', import.meta.url);
    return await import(`${modulePath.href}?t=${Date.now()}-${Math.random()}`);
}

describe('resetCommand', () => {
    describe('handleOResetCommand structure', () => {
        test('should export handleOResetCommand function', async () => {
            const { handleOResetCommand } = await import('../src/commands/resetCommand.js');
            assert.equal(typeof handleOResetCommand, 'function');
        });

        test('should export createHandleOResetCommand factory', async () => {
            const { createHandleOResetCommand } = await import('../src/commands/resetCommand.js');
            assert.equal(typeof createHandleOResetCommand, 'function');
        });
    });

    describe('outside thread', () => {
        test('should reply ephemeral error and not call clearThreadHistory', async () => {
            const { createHandleOResetCommand } = await import('../src/commands/resetCommand.js');

            let clearCalled = false;
            const replies = [];
            const mockInteraction = {
                channel: {
                    isThread: () => false,
                    id: 'channel-1'
                },
                user: { id: 'user-1' },
                reply: async options => {
                    replies.push(options);
                }
            };

            const handler = createHandleOResetCommand({
                clearThreadHistory: () => {
                    clearCalled = true;
                }
            });

            await handler(mockInteraction);

            assert.equal(clearCalled, false);
            assert.equal(replies.length, 1);
            assert.equal(replies[0].ephemeral, true);
        });

        test('should handle interaction without channel', async () => {
            const { createHandleOResetCommand } = await import('../src/commands/resetCommand.js');

            let clearCalled = false;
            const replies = [];
            const mockInteraction = {
                channel: null,
                user: { id: 'user-1' },
                reply: async options => {
                    replies.push(options);
                }
            };

            const handler = createHandleOResetCommand({
                clearThreadHistory: () => {
                    clearCalled = true;
                }
            });

            await handler(mockInteraction);

            assert.equal(clearCalled, false);
            assert.equal(replies.length, 1);
            assert.equal(replies[0].ephemeral, true);
        });
    });

    describe('inside thread', () => {
        test('should clear the history and generation controls with the correct threadId', async () => {
            const { createHandleOResetCommand } = await import('../src/commands/resetCommand.js');

            const clearedThreadIds = [];
            const clearedGenerationIds = [];
            const replies = [];
            const mockInteraction = {
                channel: {
                    isThread: () => true,
                    id: 'thread-123'
                },
                user: { id: 'user-1' },
                reply: async options => {
                    replies.push(options);
                }
            };

            const handler = createHandleOResetCommand({
                clearThreadHistory: threadId => {
                    clearedThreadIds.push(threadId);
                },
                clearGeneration: threadId => {
                    clearedGenerationIds.push(threadId);
                }
            });

            await handler(mockInteraction);

            assert.deepEqual(clearedThreadIds, ['thread-123']);
            assert.deepEqual(clearedGenerationIds, ['thread-123']);
            assert.equal(replies.length, 1);
            assert.match(replies[0].content, /リセット/);
            assert.notEqual(replies[0].ephemeral, true);
        });

        test('should reply ephemeral error when clearThreadHistory throws', async () => {
            const { createHandleOResetCommand } = await import('../src/commands/resetCommand.js');

            const replies = [];
            const mockInteraction = {
                channel: {
                    isThread: () => true,
                    id: 'thread-123'
                },
                user: { id: 'user-1' },
                reply: async options => {
                    if (options.ephemeral) {
                        replies.push(options);
                        return;
                    }
                    throw new Error('clear failed');
                }
            };

            const handler = createHandleOResetCommand({
                clearThreadHistory: () => {
                    throw new Error('boom');
                }
            });

            await handler(mockInteraction);

            assert.equal(replies.length, 1);
            assert.equal(replies[0].ephemeral, true);
        });
    });

    describe('integration with real threadManager', () => {
        test('should clear history set via setThreadHistory', async () => {
            const { createHandleOResetCommand } = await import('../src/commands/resetCommand.js');
            const threadManager = await importFreshThreadManager();

            threadManager.setThreadHistory('thread-int', [
                { role: 'user', text: 'こんにちは' },
                { role: 'assistant', text: 'お応えします' }
            ]);
            assert.ok(threadManager.getThreadHistory('thread-int').length > 0);

            const mockInteraction = {
                channel: {
                    isThread: () => true,
                    id: 'thread-int'
                },
                user: { id: 'user-1' },
                reply: async () => {}
            };

            const handler = createHandleOResetCommand({
                clearThreadHistory: threadManager.clearThreadHistory
            });

            await handler(mockInteraction);

            assert.deepEqual(threadManager.getThreadHistory('thread-int'), []);
        });
    });
});
