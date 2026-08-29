import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

describe('summaryCommand', () => {
    describe('handleOSummaryCommand structure', () => {
        test('should export handleOSummaryCommand function', async () => {
            const { handleOSummaryCommand } = await import('../src/commands/summaryCommand.js');
            assert.equal(typeof handleOSummaryCommand, 'function');
        });

        test('should export createHandleOSummaryCommand factory', async () => {
            const { createHandleOSummaryCommand } = await import(
                '../src/commands/summaryCommand.js'
            );
            assert.equal(typeof createHandleOSummaryCommand, 'function');
        });
    });

    describe('outside thread', () => {
        test('should reply ephemeral error and not call summarizeConversation', async () => {
            const { createHandleOSummaryCommand } = await import(
                '../src/commands/summaryCommand.js'
            );

            let summarizeCalled = false;
            const replies = [];
            const mockInteraction = {
                channel: {
                    isThread: () => false,
                    id: 'channel-1',
                    send: async () => ({})
                },
                user: { id: 'user-1' },
                reply: async options => {
                    replies.push(options);
                },
                deferReply: async () => {}
            };

            const handler = createHandleOSummaryCommand({
                isManagedThread: async () => true,
                getThreadHistory: () => [],
                summarizeConversation: async () => {
                    summarizeCalled = true;
                    return '要約';
                },
                sendSplitMessage: async () => {},
                buildMaidThinkingMessage: () => '思考中...'
            });

            await handler(mockInteraction);

            assert.equal(summarizeCalled, false);
            assert.equal(replies.length, 1);
            assert.equal(replies[0].ephemeral, true);
        });
    });

    describe('inside thread with empty history', () => {
        test('should reply without calling summarizeConversation', async () => {
            const { createHandleOSummaryCommand } = await import(
                '../src/commands/summaryCommand.js'
            );

            let summarizeCalled = false;
            let deferCalled = false;
            const replies = [];
            const mockInteraction = {
                channel: {
                    isThread: () => true,
                    id: 'thread-123',
                    send: async () => ({})
                },
                user: { id: 'user-1' },
                reply: async options => {
                    replies.push(options);
                },
                deferReply: async () => {
                    deferCalled = true;
                }
            };

            const handler = createHandleOSummaryCommand({
                isManagedThread: async () => true,
                getThreadHistory: () => [],
                summarizeConversation: async () => {
                    summarizeCalled = true;
                    return '要約';
                },
                sendSplitMessage: async () => {},
                buildMaidThinkingMessage: () => '思考中...'
            });

            await handler(mockInteraction);

            assert.equal(summarizeCalled, false);
            assert.equal(deferCalled, false);
            assert.equal(replies.length, 1);
            assert.match(replies[0].content, /会話がありません/);
        });
    });

    describe('inside thread with history', () => {
        test('should pass history to summarizeConversation and result to sendSplitMessage', async () => {
            const { createHandleOSummaryCommand } = await import(
                '../src/commands/summaryCommand.js'
            );

            const history = [
                { role: 'user', text: 'こんにちは' },
                { role: 'assistant', text: 'お応えします' }
            ];
            let capturedHistory = null;
            let capturedSummary = null;
            let deferCalled = false;
            let deleteReplyCalled = false;

            const mockInteraction = {
                channel: {
                    isThread: () => true,
                    id: 'thread-123',
                    send: async () => ({ id: 'thinking-msg' })
                },
                user: { id: 'user-1' },
                reply: async () => {},
                deferReply: async () => {
                    deferCalled = true;
                },
                deleteReply: async () => {
                    deleteReplyCalled = true;
                }
            };

            const handler = createHandleOSummaryCommand({
                isManagedThread: async () => true,
                getThreadHistory: () => history,
                summarizeConversation: async h => {
                    capturedHistory = h;
                    return 'これは要約です';
                },
                sendSplitMessage: async (_channel, text) => {
                    capturedSummary = text;
                },
                buildMaidThinkingMessage: () => '思考中...'
            });

            await handler(mockInteraction);

            assert.equal(deferCalled, true);
            assert.deepEqual(capturedHistory, history);
            assert.equal(capturedSummary, 'これは要約です');
            // deferReply を確定させるため deleteReply が呼ばれることを検証
            assert.equal(deleteReplyCalled, true);
        });

        test('should follow up ephemeral error when summarizeConversation throws', async () => {
            const { createHandleOSummaryCommand } = await import(
                '../src/commands/summaryCommand.js'
            );

            const followUps = [];
            const mockInteraction = {
                channel: {
                    isThread: () => true,
                    id: 'thread-123',
                    send: async () => ({ id: 'thinking-msg' })
                },
                user: { id: 'user-1' },
                reply: async () => {},
                deferReply: async () => {},
                followUp: async options => {
                    followUps.push(options);
                }
            };

            const handler = createHandleOSummaryCommand({
                isManagedThread: async () => true,
                getThreadHistory: () => [{ role: 'user', text: 'テスト' }],
                summarizeConversation: async () => {
                    throw new Error('summarize failed');
                },
                sendSplitMessage: async () => {},
                buildMaidThinkingMessage: () => '思考中...'
            });

            await handler(mockInteraction);

            assert.equal(followUps.length, 1);
            assert.equal(followUps[0].ephemeral, true);
        });
    });

    describe('inside an unmanaged thread', () => {
        test('should reject the command without reading or summarizing history', async () => {
            const { createHandleOSummaryCommand } = await import(
                '../src/commands/summaryCommand.js'
            );
            const calls = [];
            const interaction = {
                channel: { id: 'ordinary-thread', isThread: () => true },
                client: { user: { id: 'maid-1' } },
                user: { id: 'user-1' },
                reply: async options => calls.push({ type: 'reply', options })
            };

            await createHandleOSummaryCommand({
                isManagedThread: async (channel, options) => {
                    calls.push({ type: 'check', channel, options });
                    return false;
                },
                getThreadHistory: () => calls.push({ type: 'getHistory' }),
                summarizeConversation: async () => calls.push({ type: 'summarize' })
            })(interaction);

            assert.equal(calls.length, 2);
            assert.deepEqual(calls[0], {
                type: 'check',
                channel: interaction.channel,
                options: { clientId: 'maid-1' }
            });
            assert.equal(calls[1].type, 'reply');
            assert.equal(calls[1].options.ephemeral, true);
            assert.match(calls[1].options.content, /\/o/);
        });
    });
});
