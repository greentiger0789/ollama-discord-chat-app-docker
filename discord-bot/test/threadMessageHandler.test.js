import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';
import { handleThreadMessage as handleThreadMessageImpl } from '../src/handlers/threadMessageHandler.js';

async function handleThreadMessage(message, deps = {}) {
    return await handleThreadMessageImpl(message, {
        isManagedThread: async () => true,
        ...deps
    });
}

async function importFreshThreadManager() {
    const modulePath = new URL('../src/threadManager.js', import.meta.url);
    return await import(`${modulePath.href}?t=${Date.now()}-${Math.random()}`);
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

let nextAddressingThreadId = 1;

function createAddressingMessage({ threadId, mentions, reference, attachments, client } = {}) {
    return {
        channel: {
            id: threadId ?? `thread-addressing-${nextAddressingThreadId++}`,
            isThread: () => true,
            send: async () => ({ edit: async () => {} })
        },
        author: { bot: false, id: 'author-1' },
        content: '宛先を含むメッセージ',
        mentions,
        reference,
        attachments,
        client
    };
}

function createSuccessfulDeps(overrides = {}) {
    return {
        buildMaidThinkingMessage: () => '考え中…',
        sendSplitMessage: async () => {},
        generateResponse: async () => '応答',
        addToThreadHistory: () => {},
        getThreadHistory: () => [],
        registerGeneration: (_threadId, entry) => ({ ...entry, state: 'generating' }),
        completeGeneration: () => {},
        clearCompletedGeneration: () => {},
        ...overrides
    };
}

describe('threadMessageHandler', () => {
    let originalConsoleError;

    before(() => {
        originalConsoleError = console.error;
        console.error = () => {};
    });

    after(() => {
        console.error = originalConsoleError;
    });

    describe('handleThreadMessage structure', () => {
        test('should export handleThreadMessage function', () => {
            assert.equal(
                typeof handleThreadMessage,
                'function',
                'Should export handleThreadMessage as a function'
            );
        });

        test('handleThreadMessage should be async', () => {
            assert.ok(
                handleThreadMessage.constructor.name === 'AsyncFunction' ||
                    handleThreadMessage.toString().includes('async'),
                'handleThreadMessage should be an async function'
            );
        });
    });

    describe('handleThreadMessage with mock message', () => {
        test('should ignore unmanaged threads before any side effect', async () => {
            const calls = [];
            const message = {
                channel: {
                    id: 'ordinary-thread',
                    isThread: () => true,
                    send: async () => calls.push('channel.send')
                },
                author: { bot: false, id: 'user-1' },
                content: '通常スレッドの投稿'
            };

            await handleThreadMessage(message, {
                isManagedThread: async (channel, options) => {
                    calls.push({ channel, options });
                    return false;
                },
                clientId: 'maid-1',
                clearCompletedGeneration: () => calls.push('clearCompletedGeneration'),
                getThreadHistory: () => calls.push('getThreadHistory'),
                addToThreadHistory: () => calls.push('addToThreadHistory'),
                generateResponse: async () => calls.push('generateResponse')
            });

            assert.deepEqual(calls, [
                {
                    channel: message.channel,
                    options: { clientId: 'maid-1' }
                }
            ]);
        });

        test('should not persist or report an error when a generation is aborted', async () => {
            const added = [];
            const sent = [];
            let controller = null;
            const thinkingMessage = {
                id: 'thinking-abort',
                edit: async content => sent.push({ type: 'edit', content }),
                react: async () => {}
            };
            const message = {
                channel: {
                    id: 'thread-abort',
                    isThread: () => true,
                    send: async content => {
                        sent.push({ type: 'send', content });
                        return thinkingMessage;
                    }
                },
                author: { bot: false, id: 'user-1' },
                content: '中断する質問'
            };

            const handling = handleThreadMessage(message, {
                buildMaidThinkingMessage: () => '考え中…',
                getThreadHistory: () => [],
                addToThreadHistory: (_threadId, entry) => added.push(entry),
                setThreadHistory: () => {},
                registerGeneration: (_threadId, entry) => {
                    controller = entry.controller;
                    return { ...entry, state: 'generating' };
                },
                completeGeneration: () => {},
                generateResponse: async (_prompt, _history, { signal }) => {
                    queueMicrotask(() => controller.abort());
                    return await new Promise((_resolve, reject) => {
                        signal.addEventListener(
                            'abort',
                            () => {
                                const err = new Error('aborted');
                                err.name = 'ResponseAbortedError';
                                reject(err);
                            },
                            { once: true }
                        );
                    });
                },
                sendSplitMessage: async () => {
                    assert.fail('aborted generation must not send a response');
                }
            });

            await handling;

            assert.deepEqual(added, [{ role: 'user', text: '中断する質問', speaker: 'ユーザー' }]);
            assert.ok(
                sent.some(item => item.type === 'edit' && item.content === '✖️ 中断しました。')
            );
            assert.ok(!sent.some(item => item.content === 'エラーが発生しました。'));
        });

        test('should return early for non-thread channels', async () => {
            const mockMessage = {
                channel: {
                    isThread: () => false
                },
                author: {
                    bot: false
                }
            };

            // 依存関係が呼ばれないことを確認するためのトラッカー
            let buildMaidThinkingMessageCalled = false;
            let generateResponseCalled = false;
            let addToThreadHistoryCalled = false;
            let getThreadHistoryCalled = false;

            const deps = {
                buildMaidThinkingMessage: () => {
                    buildMaidThinkingMessageCalled = true;
                    return '🧹 考え中...';
                },
                sendSplitMessage: async () => {},
                generateResponse: async () => {
                    generateResponseCalled = true;
                    return 'テスト応答';
                },
                addToThreadHistory: () => {
                    addToThreadHistoryCalled = true;
                },
                getThreadHistory: () => {
                    getThreadHistoryCalled = true;
                    return [];
                }
            };

            await handleThreadMessage(mockMessage, deps);

            // 非スレッドチャンネルでは依存関係が呼ばれないことを確認
            assert.equal(
                buildMaidThinkingMessageCalled,
                false,
                'Should not call buildMaidThinkingMessage'
            );
            assert.equal(generateResponseCalled, false, 'Should not call generateResponse');
            assert.equal(addToThreadHistoryCalled, false, 'Should not call addToThreadHistory');
            assert.equal(getThreadHistoryCalled, false, 'Should not call getThreadHistory');
        });

        test('should return early for bot messages', async () => {
            let sendCalled = false;
            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: 'thread-123',
                    send: async () => {
                        sendCalled = true;
                        return { edit: async () => {} };
                    }
                },
                author: {
                    bot: true
                },
                content: 'テストメッセージ'
            };

            let generateResponseCalled = false;

            const deps = {
                buildMaidThinkingMessage: () => '🧹 考え中...',
                sendSplitMessage: async () => {},
                generateResponse: async () => {
                    generateResponseCalled = true;
                    return 'テスト応答';
                },
                addToThreadHistory: () => {},
                getThreadHistory: () => []
            };

            await handleThreadMessage(mockMessage, deps);

            // ボットメッセージでは依存関係が呼ばれないことを確認
            assert.equal(sendCalled, false, 'Should not call channel.send for bot messages');
            assert.equal(
                generateResponseCalled,
                false,
                'Should not call generateResponse for bot messages'
            );
        });

        test('should process valid thread messages with all dependencies', async () => {
            let buildMaidThinkingMessageCalled = false;
            let sendSplitMessageCalled = false;
            let generateResponseCalled = false;
            let addToThreadHistoryCalled = false;
            let getThreadHistoryCalled = false;

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: 'thread-123',
                    send: async () => ({ edit: async () => {} })
                },
                author: {
                    bot: false
                },
                content: 'テストメッセージ'
            };

            const deps = {
                buildMaidThinkingMessage: () => {
                    buildMaidThinkingMessageCalled = true;
                    return '🧹 考え中...';
                },
                sendSplitMessage: async () => {
                    sendSplitMessageCalled = true;
                },
                generateResponse: async () => {
                    generateResponseCalled = true;
                    return 'テスト応答';
                },
                addToThreadHistory: () => {
                    addToThreadHistoryCalled = true;
                },
                getThreadHistory: () => {
                    getThreadHistoryCalled = true;
                    return [];
                }
            };

            await handleThreadMessage(mockMessage, deps);

            assert.equal(
                buildMaidThinkingMessageCalled,
                true,
                'Should call buildMaidThinkingMessage'
            );
            assert.equal(sendSplitMessageCalled, true, 'Should call sendSplitMessage');
            assert.equal(generateResponseCalled, true, 'Should call generateResponse');
            assert.equal(addToThreadHistoryCalled, true, 'Should call addToThreadHistory');
            assert.equal(getThreadHistoryCalled, true, 'Should call getThreadHistory');
        });

        test('should pass correct arguments to dependencies', async () => {
            let capturedThreadId = null;
            let _capturedHistory = null;
            let capturedUserMessage = null;
            let capturedAssistantMessage = null;

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: 'thread-456',
                    send: async () => ({ edit: async () => {} })
                },
                author: {
                    bot: false
                },
                content: 'ユーザーメッセージ'
            };

            const deps = {
                buildMaidThinkingMessage: () => '🧹 考え中...',
                sendSplitMessage: async () => {},
                generateResponse: async (_content, history) => {
                    _capturedHistory = history;
                    return 'アシスタント応答';
                },
                addToThreadHistory: (threadId, message) => {
                    capturedThreadId = threadId;
                    if (message.role === 'user') {
                        capturedUserMessage = message;
                    } else {
                        capturedAssistantMessage = message;
                    }
                },
                getThreadHistory: () => []
            };

            await handleThreadMessage(mockMessage, deps);

            assert.equal(capturedThreadId, 'thread-456', 'Should pass correct thread ID');
            assert.deepEqual(
                capturedUserMessage,
                { role: 'user', text: 'ユーザーメッセージ', speaker: 'ユーザー' },
                'Should add user message to history'
            );
            assert.deepEqual(
                capturedAssistantMessage,
                { role: 'assistant', text: 'アシスタント応答' },
                'Should add assistant message to history'
            );
        });

        test('should resolve and pass the current speaker to the response generator', async () => {
            let capturedSpeaker = null;
            let persistedUserMessage = null;
            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: 'thread-speaker',
                    send: async () => ({ edit: async () => {} })
                },
                author: { bot: false },
                content: '発言者の確認'
            };

            await handleThreadMessage(mockMessage, {
                buildMaidThinkingMessage: () => '🧹 考え中...',
                sendSplitMessage: async () => {},
                generateResponse: async (_content, _history, options) => {
                    capturedSpeaker = options.speaker;
                    return '応答';
                },
                addToThreadHistory: (_threadId, entry) => {
                    if (entry.role === 'user') persistedUserMessage = entry;
                },
                getThreadHistory: () => [],
                resolveSpeakerName: () => '注入した名前'
            });

            assert.equal(capturedSpeaker, '注入した名前');
            assert.deepEqual(persistedUserMessage, {
                role: 'user',
                text: '発言者の確認',
                speaker: '注入した名前'
            });
        });
    });

    describe('addressed recipient filtering', () => {
        test('should ignore a direct mention of another human before any side effect', async () => {
            const calls = [];
            const message = createAddressingMessage({
                mentions: {
                    users: new Map([['human-2', { id: 'human-2', bot: false }]])
                },
                attachments: new Map([['attachment-1', { name: 'secret.txt' }]])
            });
            message.channel.send = async () => calls.push('channel.send');

            await handleThreadMessage(message, {
                clientId: 'maid-1',
                clearCompletedGeneration: () => calls.push('clearCompletedGeneration'),
                getThreadHistory: () => calls.push('getThreadHistory'),
                addToThreadHistory: () => calls.push('addToThreadHistory'),
                loadAttachmentText: async () => calls.push('loadAttachmentText'),
                buildMaidThinkingMessage: () => calls.push('buildMaidThinkingMessage'),
                generateResponse: async () => calls.push('generateResponse'),
                sendSplitMessage: async () => calls.push('sendSplitMessage'),
                registerGeneration: () => calls.push('registerGeneration')
            });

            assert.deepEqual(calls, []);
        });

        test('should ignore a reply to another human with or without a direct mention', async () => {
            for (const [caseName, users] of [
                ['without-notification', new Map()],
                ['with-notification', new Map([['human-2', { id: 'human-2', bot: false }]])]
            ]) {
                const calls = [];
                const message = createAddressingMessage({
                    threadId: `thread-reply-${caseName}`,
                    reference: { messageId: `reference-${caseName}` },
                    mentions: {
                        users,
                        repliedUser: { id: 'human-2', bot: false }
                    }
                });

                await handleThreadMessage(
                    message,
                    createSuccessfulDeps({
                        clientId: 'maid-1',
                        clearCompletedGeneration: () => calls.push('clearCompletedGeneration'),
                        fetchReferencedMessage: async () => calls.push('fetchReferencedMessage'),
                        generateResponse: async () => calls.push('generateResponse')
                    })
                );

                assert.deepEqual(calls, [], caseName);
            }
        });

        test('should process a direct mention of Maid-chan', async () => {
            let generated = false;
            await handleThreadMessage(
                createAddressingMessage({
                    mentions: {
                        users: new Map([['maid-1', { id: 'maid-1', bot: true }]])
                    }
                }),
                createSuccessfulDeps({
                    clientId: 'maid-1',
                    generateResponse: async () => {
                        generated = true;
                        return '応答';
                    }
                })
            );

            assert.equal(generated, true);
        });

        test('should ignore a mixed mention of Maid-chan and another human', async () => {
            let cleared = false;
            await handleThreadMessage(
                createAddressingMessage({
                    mentions: {
                        users: new Map([
                            ['maid-1', { id: 'maid-1', bot: true }],
                            ['human-2', { id: 'human-2', bot: false }]
                        ])
                    }
                }),
                createSuccessfulDeps({
                    clientId: 'maid-1',
                    clearCompletedGeneration: () => {
                        cleared = true;
                    }
                })
            );

            assert.equal(cleared, false);
        });

        test('should process direct mentions of and replies to another bot', async () => {
            let generatedCount = 0;
            const deps = createSuccessfulDeps({
                clientId: 'maid-1',
                fetchReferencedMessage: async () => ({
                    author: { bot: true },
                    content: '他の Bot の投稿'
                }),
                generateResponse: async () => {
                    generatedCount += 1;
                    return '応答';
                }
            });

            await handleThreadMessage(
                createAddressingMessage({
                    mentions: {
                        users: new Map([['bot-2', { id: 'bot-2', bot: true }]])
                    }
                }),
                deps
            );
            await handleThreadMessage(
                createAddressingMessage({
                    reference: { messageId: 'reference-bot-2' },
                    mentions: {
                        users: new Map(),
                        repliedUser: { id: 'bot-2', bot: true }
                    }
                }),
                deps
            );

            assert.equal(generatedCount, 2);
        });

        test('should preserve existing behavior when clientId cannot be resolved', async () => {
            let generated = false;
            await handleThreadMessage(
                createAddressingMessage({
                    mentions: {
                        users: new Map([['human-2', { id: 'human-2', bot: false }]])
                    }
                }),
                createSuccessfulDeps({
                    generateResponse: async () => {
                        generated = true;
                        return '応答';
                    }
                })
            );

            assert.equal(generated, true);
        });

        test('should resolve clientId from the message client', async () => {
            let cleared = false;
            await handleThreadMessage(
                createAddressingMessage({
                    client: { user: { id: 'maid-1' } },
                    mentions: {
                        users: new Map([['human-2', { id: 'human-2', bot: false }]])
                    }
                }),
                createSuccessfulDeps({
                    clearCompletedGeneration: () => {
                        cleared = true;
                    }
                })
            );

            assert.equal(cleared, false);
        });

        test('should process messages with missing mention data or only non-user mentions', async () => {
            let generatedCount = 0;
            const deps = createSuccessfulDeps({
                clientId: 'maid-1',
                generateResponse: async () => {
                    generatedCount += 1;
                    return '応答';
                }
            });

            await handleThreadMessage(createAddressingMessage(), deps);
            await handleThreadMessage(
                createAddressingMessage({
                    mentions: { users: new Map(), roles: new Map(), everyone: true }
                }),
                deps
            );

            assert.equal(generatedCount, 2);
        });
    });

    describe('error handling', () => {
        test('should handle generateResponse errors gracefully', async () => {
            let sendCalled = false;
            let sentContent = null;

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: 'thread-789',
                    send: async content => {
                        sendCalled = true;
                        sentContent = content;
                        return { edit: async () => {} };
                    }
                },
                author: {
                    bot: false
                },
                content: 'エラーテスト'
            };

            const deps = {
                buildMaidThinkingMessage: () => '🧹 考え中...',
                sendSplitMessage: async () => {},
                generateResponse: async () => {
                    throw new Error('生成エラー');
                },
                addToThreadHistory: () => {},
                getThreadHistory: () => []
            };

            // エラーがスローされないことを確認
            await handleThreadMessage(mockMessage, deps);

            // エラーハンドリングでsendが呼ばれることを確認
            assert.equal(sendCalled, true, 'Should call channel.send for error handling');
            assert.ok(sentContent?.includes('エラー'), 'Should send error message');
        });

        test('should handle sendSplitMessage errors gracefully', async () => {
            const sentContents = [];

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: 'thread-error',
                    send: async content => {
                        sentContents.push(content);
                        return { edit: async () => {} };
                    }
                },
                author: {
                    bot: false
                },
                content: 'エラーテスト'
            };

            const deps = {
                buildMaidThinkingMessage: () => '🧹 考え中...',
                sendSplitMessage: async () => {
                    throw new Error('送信エラー');
                },
                generateResponse: async () => 'テスト応答',
                addToThreadHistory: () => {},
                getThreadHistory: () => []
            };

            // エラーがスローされないことを確認
            await handleThreadMessage(mockMessage, deps);

            assert.equal(
                sentContents.length,
                2,
                'Should send both the thinking message and the error message'
            );
            assert.equal(sentContents[0], '🧹 考え中...', 'Should send the thinking message first');
            assert.ok(
                typeof sentContents[1] === 'string' && sentContents[1].includes('エラー'),
                'Should send an error message after sendSplitMessage fails'
            );
        });
    });

    describe('thread history integration', () => {
        test('should call getThreadHistory with correct thread ID', async () => {
            let capturedThreadId = null;

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: 'thread-history-1',
                    send: async () => ({ edit: async () => {} })
                },
                author: {
                    bot: false
                },
                content: '履歴テスト'
            };

            const deps = {
                buildMaidThinkingMessage: () => '🧹 考え中...',
                sendSplitMessage: async () => {},
                generateResponse: async () => 'テスト応答',
                addToThreadHistory: () => {},
                getThreadHistory: threadId => {
                    capturedThreadId = threadId;
                    return [];
                }
            };

            await handleThreadMessage(mockMessage, deps);

            assert.equal(
                capturedThreadId,
                'thread-history-1',
                'Should call getThreadHistory with correct thread ID'
            );
        });

        test('should pass history to generateResponse', async () => {
            let capturedHistory = null;
            const existingHistory = [
                { role: 'user', text: '以前のメッセージ' },
                { role: 'assistant', text: '以前の応答' }
            ];

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: 'thread-history-2',
                    send: async () => ({ edit: async () => {} })
                },
                author: {
                    bot: false
                },
                content: '新しいメッセージ'
            };

            const deps = {
                buildMaidThinkingMessage: () => '🧹 考え中...',
                sendSplitMessage: async () => {},
                generateResponse: async (_content, history) => {
                    capturedHistory = history;
                    return '新しい応答';
                },
                addToThreadHistory: () => {},
                getThreadHistory: () => existingHistory
            };

            await handleThreadMessage(mockMessage, deps);

            assert.deepEqual(
                capturedHistory,
                existingHistory,
                'Should pass existing history to generateResponse'
            );
        });

        test('should add messages to history in correct order', async () => {
            const addedMessages = [];

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: 'thread-history-3',
                    send: async () => ({ edit: async () => {} })
                },
                author: {
                    bot: false
                },
                content: '順序テスト'
            };

            const deps = {
                buildMaidThinkingMessage: () => '🧹 考え中...',
                sendSplitMessage: async () => {},
                generateResponse: async () => '順序応答',
                addToThreadHistory: (_threadId, message) => {
                    addedMessages.push(message);
                },
                getThreadHistory: () => []
            };

            await handleThreadMessage(mockMessage, deps);

            assert.equal(addedMessages.length, 2, 'Should add two messages to history');
            assert.deepEqual(
                addedMessages[0],
                { role: 'user', text: '順序テスト', speaker: 'ユーザー' },
                'First message should be user message'
            );
            assert.deepEqual(
                addedMessages[1],
                { role: 'assistant', text: '順序応答' },
                'Second message should be assistant message'
            );
        });

        test('should pass only prior history to generateResponse when using the real thread manager', async () => {
            const threadManager = await importFreshThreadManager();
            const threadId = 'thread-history-real';
            let capturedHistory = null;

            threadManager.initializeThread(threadId, '以前のメッセージ');
            threadManager.addToThreadHistory(threadId, {
                role: 'assistant',
                text: '以前の応答'
            });

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: threadId,
                    send: async () => ({ edit: async () => {} })
                },
                author: {
                    bot: false
                },
                content: '新しいメッセージ'
            };

            const deps = {
                buildMaidThinkingMessage: () => '🧹 考え中...',
                sendSplitMessage: async () => {},
                generateResponse: async (_content, history) => {
                    capturedHistory = history;
                    return '新しい応答';
                },
                addToThreadHistory: threadManager.addToThreadHistory,
                getThreadHistory: threadManager.getThreadHistory
            };

            await handleThreadMessage(mockMessage, deps);

            assert.deepEqual(capturedHistory, [
                { role: 'user', text: '以前のメッセージ' },
                { role: 'assistant', text: '以前の応答' }
            ]);
            assert.deepEqual(threadManager.getThreadHistory(threadId), [
                { role: 'user', text: '以前のメッセージ' },
                { role: 'assistant', text: '以前の応答' },
                { role: 'user', text: '新しいメッセージ', speaker: 'ユーザー' },
                { role: 'assistant', text: '新しい応答' }
            ]);
        });

        test('should serialize concurrent messages in the same thread', async () => {
            const threadManager = await importFreshThreadManager();
            const threadId = 'thread-history-queued';
            const firstStarted = createDeferred();
            const firstRelease = createDeferred();
            const secondStarted = createDeferred();
            const generateCalls = [];

            threadManager.initializeThread(threadId);

            const buildMessage = content => ({
                channel: {
                    isThread: () => true,
                    id: threadId,
                    send: async () => ({ edit: async () => {} })
                },
                author: {
                    bot: false
                },
                content
            });

            const deps = {
                buildMaidThinkingMessage: () => '🧹 考え中...',
                sendSplitMessage: async () => {},
                generateResponse: async (content, history) => {
                    generateCalls.push({ content, history });

                    if (content === 'first') {
                        firstStarted.resolve();
                        await firstRelease.promise;
                    } else {
                        secondStarted.resolve();
                    }

                    return `${content}-response`;
                },
                addToThreadHistory: threadManager.addToThreadHistory,
                getThreadHistory: threadManager.getThreadHistory
            };

            const firstPromise = handleThreadMessage(buildMessage('first'), deps);
            await firstStarted.promise;

            const secondPromise = handleThreadMessage(buildMessage('second'), deps);
            await Promise.resolve();

            assert.equal(
                generateCalls.length,
                1,
                'Second message should wait until the first response finishes'
            );

            firstRelease.resolve();
            await secondStarted.promise;
            await Promise.all([firstPromise, secondPromise]);

            assert.deepEqual(generateCalls, [
                {
                    content: 'first',
                    history: []
                },
                {
                    content: 'second',
                    history: [
                        { role: 'user', text: 'first', speaker: 'ユーザー' },
                        { role: 'assistant', text: 'first-response' }
                    ]
                }
            ]);
            assert.deepEqual(threadManager.getThreadHistory(threadId), [
                { role: 'user', text: 'first', speaker: 'ユーザー' },
                { role: 'assistant', text: 'first-response' },
                { role: 'user', text: 'second', speaker: 'ユーザー' },
                { role: 'assistant', text: 'second-response' }
            ]);
        });
    });

    describe('message flow', () => {
        test('should call buildMaidThinkingMessage and send thinking message', async () => {
            let sentContent = null;

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: 'thread-flow-1',
                    send: async content => {
                        sentContent = content;
                        return { edit: async () => {} };
                    }
                },
                author: {
                    bot: false
                },
                content: 'フローテスト'
            };

            const deps = {
                buildMaidThinkingMessage: () => '🧹 考え中...',
                sendSplitMessage: async () => {},
                generateResponse: async () => 'フロー応答',
                addToThreadHistory: () => {},
                getThreadHistory: () => []
            };

            await handleThreadMessage(mockMessage, deps);

            assert.equal(sentContent, '🧹 考え中...', 'Should send thinking message');
        });

        test('should call sendSplitMessage with response', async () => {
            let capturedChannel = null;
            let capturedResponse = null;
            let capturedThinkingMsg = null;

            const thinkingMsg = { edit: async () => {} };

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: 'thread-flow-2',
                    send: async () => thinkingMsg
                },
                author: {
                    bot: false
                },
                content: 'フローテスト2'
            };

            const deps = {
                buildMaidThinkingMessage: () => '🧹 考え中...',
                sendSplitMessage: async (channel, response, msg) => {
                    capturedChannel = channel;
                    capturedResponse = response;
                    capturedThinkingMsg = msg;
                },
                generateResponse: async () => 'フロー応答2',
                addToThreadHistory: () => {},
                getThreadHistory: () => []
            };

            await handleThreadMessage(mockMessage, deps);

            assert.equal(
                capturedChannel,
                mockMessage.channel,
                'Should pass channel to sendSplitMessage'
            );
            assert.equal(
                capturedResponse,
                'フロー応答2',
                'Should pass response to sendSplitMessage'
            );
            assert.equal(
                capturedThinkingMsg,
                thinkingMsg,
                'Should pass thinking message to sendSplitMessage'
            );
        });
    });

    describe('generateResponse integration', () => {
        test('should pass user message content to generateResponse', async () => {
            let capturedContent = null;

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: 'thread-gen-1',
                    send: async () => ({ edit: async () => {} })
                },
                author: {
                    bot: false
                },
                content: '生成テスト'
            };

            const deps = {
                buildMaidThinkingMessage: () => '🧹 考え中...',
                sendSplitMessage: async () => {},
                generateResponse: async content => {
                    capturedContent = content;
                    return '生成応答';
                },
                addToThreadHistory: () => {},
                getThreadHistory: () => []
            };

            await handleThreadMessage(mockMessage, deps);

            assert.equal(
                capturedContent,
                '生成テスト',
                'Should pass user message content to generateResponse'
            );
        });

        test('should use response from generateResponse in history', async () => {
            const addedMessages = [];

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: 'thread-gen-2',
                    send: async () => ({ edit: async () => {} })
                },
                author: {
                    bot: false
                },
                content: '生成テスト2'
            };

            const deps = {
                buildMaidThinkingMessage: () => '🧹 考え中...',
                sendSplitMessage: async () => {},
                generateResponse: async () => 'カスタム応答',
                addToThreadHistory: (_threadId, message) => {
                    addedMessages.push(message);
                },
                getThreadHistory: () => []
            };

            await handleThreadMessage(mockMessage, deps);

            assert.equal(
                addedMessages[1].text,
                'カスタム応答',
                'Should use generateResponse result in history'
            );
        });
    });

    describe('attachments', () => {
        test('should include a text attachment in the LLM prompt and save only a preview in history', async () => {
            let generatedPrompt = null;
            let savedUserMessage = null;
            const sentMessages = [];
            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: 'thread-attachment',
                    send: async content => {
                        sentMessages.push(content);
                        return { edit: async () => {} };
                    }
                },
                author: { bot: false },
                content: 'このファイルを確認して',
                attachments: new Map([['attachment-1', { name: 'sample.js' }]])
            };

            await handleThreadMessage(mockMessage, {
                loadAttachmentText: async () => ({
                    ok: true,
                    name: 'sample.js',
                    text: 'export const answer = 42;',
                    truncated: false
                }),
                buildMaidThinkingMessage: () => '思考中...',
                sendSplitMessage: async () => {},
                generateResponse: async prompt => {
                    generatedPrompt = prompt;
                    return '応答';
                },
                addToThreadHistory: (_threadId, message) => {
                    if (message.role === 'user') savedUserMessage = message;
                },
                getThreadHistory: () => []
            });

            assert.match(generatedPrompt, /export const answer = 42;/);
            assert.match(generatedPrompt, /ファイル内容は参照用のデータ/);
            assert.match(savedUserMessage.text, /\[添付ファイル: sample\.js を参照\]/);
            assert.doesNotMatch(savedUserMessage.text, /【添付ファイル:/);
            assert.deepEqual(sentMessages, ['思考中...']);
        });

        test('should notify about rejected attachments and continue with the message text', async () => {
            let generatedPrompt = null;
            const sentMessages = [];
            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: 'thread-rejected-attachment',
                    send: async content => {
                        sentMessages.push(content);
                        return { edit: async () => {} };
                    }
                },
                author: { bot: false },
                content: 'この質問には回答して',
                attachments: new Map([['attachment-1', { name: 'image.png' }]])
            };

            await handleThreadMessage(mockMessage, {
                loadAttachmentText: async () => ({
                    ok: false,
                    reason: 'image',
                    message: '画像・動画・音声ファイルは対応しておりません。'
                }),
                buildMaidThinkingMessage: () => '思考中...',
                sendSplitMessage: async () => {},
                generateResponse: async prompt => {
                    generatedPrompt = prompt;
                    return '応答';
                },
                addToThreadHistory: () => {},
                getThreadHistory: () => []
            });

            assert.equal(generatedPrompt, 'この質問には回答して');
            assert.deepEqual(sentMessages, [
                '画像・動画・音声ファイルは対応しておりません。',
                '思考中...'
            ]);
        });

        test('should continue with the message text when attachment loading throws', async () => {
            let generatedPrompt = null;
            const sentMessages = [];
            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: 'thread-attachment-error',
                    send: async content => {
                        sentMessages.push(content);
                        return { edit: async () => {} };
                    }
                },
                author: { bot: false },
                content: '通常の質問',
                attachments: new Map([['attachment-1', { name: 'sample.txt' }]])
            };

            await handleThreadMessage(mockMessage, {
                loadAttachmentText: async () => {
                    throw new Error('download failed');
                },
                buildMaidThinkingMessage: () => '思考中...',
                sendSplitMessage: async () => {},
                generateResponse: async prompt => {
                    generatedPrompt = prompt;
                    return '応答';
                },
                addToThreadHistory: () => {},
                getThreadHistory: () => []
            });

            assert.equal(generatedPrompt, '通常の質問');
            assert.deepEqual(sentMessages, [
                '添付ファイルのダウンロードに失敗しました。',
                '思考中...'
            ]);
        });
    });

    describe('logging', () => {
        test('should log thread follow-up lifecycle at info level', async () => {
            const originalConsoleInfo = console.info;
            const originalLogLevel = process.env.LOG_LEVEL;
            const infoLogs = [];

            console.info = (...args) => {
                infoLogs.push(args);
            };
            process.env.LOG_LEVEL = 'info';

            try {
                const mockMessage = {
                    channel: {
                        isThread: () => true,
                        id: 'thread-log-2',
                        send: async () => ({ edit: async () => {} })
                    },
                    author: {
                        bot: false,
                        id: 'user-2'
                    },
                    content: 'ログテスト'
                };

                await handleThreadMessage(mockMessage, {
                    buildMaidThinkingMessage: () => '思考中...',
                    sendSplitMessage: async () => {},
                    generateResponse: async () => 'ログ応答',
                    addToThreadHistory: () => {},
                    getThreadHistory: () => []
                });
            } finally {
                console.info = originalConsoleInfo;
                if (originalLogLevel === undefined) {
                    delete process.env.LOG_LEVEL;
                } else {
                    process.env.LOG_LEVEL = originalLogLevel;
                }
            }

            const handlingLog = infoLogs.find(
                ([message]) => message === 'Handling thread follow-up message'
            );
            const completedLog = infoLogs.find(
                ([message]) => message === 'Completed thread follow-up response'
            );

            assert.ok(handlingLog);
            assert.ok(completedLog);
            assert.equal(handlingLog[1]?.scope, 'threadMessageHandler');
            assert.equal(handlingLog[1]?.threadId, 'thread-log-2');
            assert.equal(handlingLog[1]?.authorId, 'user-2');
            assert.equal(completedLog[1]?.responseLength, 4);
        });
    });
});
