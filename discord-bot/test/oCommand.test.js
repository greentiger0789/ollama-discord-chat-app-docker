import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';

async function importFreshThreadManager() {
    const modulePath = new URL('../src/threadManager.js', import.meta.url);
    return await import(`${modulePath.href}?t=${Date.now()}-${Math.random()}`);
}

describe('oCommand', () => {
    let createHandleOCommand;
    let handleOCommand;
    let originalConsoleError;

    before(async () => {
        // console.errorをモックしてエラーログを抑制
        originalConsoleError = console.error;
        console.error = () => {};

        const module = await import('../src/commands/oCommand.js');
        createHandleOCommand = module.createHandleOCommand;
        handleOCommand = module.handleOCommand;
    });

    after(() => {
        console.error = originalConsoleError;
    });

    describe('handleOCommand structure', () => {
        test('should export handleOCommand function', () => {
            assert.equal(
                typeof handleOCommand,
                'function',
                'Should export handleOCommand as a function'
            );
        });

        test('handleOCommand should be async', () => {
            assert.ok(
                handleOCommand.constructor.name === 'AsyncFunction' ||
                    handleOCommand.toString().includes('async'),
                'handleOCommand should be an async function'
            );
        });

        test('should export createHandleOCommand factory', () => {
            assert.equal(
                typeof createHandleOCommand,
                'function',
                'Should export createHandleOCommand as a function'
            );
        });
    });

    describe('handleOCommand with mock interaction', () => {
        test('should defer reply', async () => {
            let deferCalled = false;
            const mockInteraction = {
                options: { getString: () => 'テストプロンプト' },
                deferReply: async () => {
                    deferCalled = true;
                },
                followUp: async () => ({
                    startThread: async () => ({ id: 'thread-123', send: async () => {} })
                }),
                user: { username: 'testuser' }
            };

            // モック依存関係
            const mockHandleOCommand = createHandleOCommand({
                generateResponse: async () => 'テスト応答',
                getThreadHistory: async () => [],
                addToThreadHistory: async () => {},
                initializeThread: () => {},
                buildMaidThinkingMessage: () => '思考中...',
                sendSplitMessage: async () => {}
            });

            await mockHandleOCommand(mockInteraction);
            assert.ok(deferCalled, 'deferReply should be called');
        });

        test('should get prompt from interaction options', async () => {
            let capturedPrompt = null;
            const mockInteraction = {
                options: {
                    getString: name => {
                        if (name === 'prompt') {
                            capturedPrompt = 'テスト用プロンプト';
                            return capturedPrompt;
                        }
                        return null;
                    }
                },
                deferReply: async () => {},
                followUp: async () => ({
                    startThread: async () => ({ id: 'thread-123', send: async () => {} })
                }),
                user: { username: 'testuser' }
            };

            const mockHandleOCommand = createHandleOCommand({
                generateResponse: async () => 'テスト応答',
                getThreadHistory: async () => [],
                addToThreadHistory: async () => {},
                initializeThread: () => {},
                buildMaidThinkingMessage: () => '思考中...',
                sendSplitMessage: async () => {}
            });

            await mockHandleOCommand(mockInteraction);
            assert.equal(
                capturedPrompt,
                'テスト用プロンプト',
                'Should get prompt from interaction options'
            );
        });

        test('should pass only prior history to generateResponse and persist the full exchange', async () => {
            const threadManager = await importFreshThreadManager();
            let capturedHistory = null;
            let capturedOptions = null;

            const thread = {
                id: 'thread-history-1',
                send: async () => ({ edit: async () => {} })
            };

            const mockInteraction = {
                options: { getString: () => '初回プロンプト' },
                deferReply: async () => {},
                followUp: async () => ({
                    startThread: async () => thread
                }),
                user: { username: 'testuser' }
            };

            const mockHandleOCommand = createHandleOCommand({
                generateResponse: async (_prompt, history, options) => {
                    capturedHistory = history;
                    capturedOptions = options;
                    return 'テスト応答';
                },
                getThreadHistory: threadManager.getThreadHistory,
                addToThreadHistory: threadManager.addToThreadHistory,
                initializeThread: threadManager.initializeThread,
                buildMaidThinkingMessage: () => '思考中...',
                sendSplitMessage: async () => {}
            });

            await mockHandleOCommand(mockInteraction);

            assert.deepEqual(capturedHistory, []);
            assert.deepEqual(threadManager.getThreadHistory(thread.id), [
                { role: 'user', text: '初回プロンプト', speaker: 'testuser' },
                { role: 'assistant', text: 'テスト応答' }
            ]);
            assert.equal(capturedOptions.speaker, 'testuser');
            assert.ok(capturedOptions.signal instanceof AbortSignal);
        });
    });

    describe('thread naming', () => {
        test('should pass generated thread name to startThread', async () => {
            let capturedThreadName = null;

            const mockInteraction = {
                options: { getString: () => 'これはスレッド名のテストです' },
                deferReply: async () => {},
                followUp: async () => ({
                    startThread: async ({ name }) => {
                        capturedThreadName = name;
                        return { id: 'thread-123', send: async () => {} };
                    }
                }),
                user: { username: 'testuser' }
            };

            const mockHandleOCommand = createHandleOCommand({
                generateResponse: async () => 'テスト応答',
                getThreadHistory: () => [],
                addToThreadHistory: () => {},
                initializeThread: () => {},
                buildMaidThinkingMessage: () => '思考中...',
                sendSplitMessage: async () => {}
            });

            await mockHandleOCommand(mockInteraction);

            assert.equal(capturedThreadName, 'これはスレッド名のテストです');
        });

        test('should use custom generateThreadName when injected', async () => {
            let capturedThreadName = null;

            const mockInteraction = {
                options: { getString: () => 'プロンプト' },
                deferReply: async () => {},
                followUp: async () => ({
                    startThread: async ({ name }) => {
                        capturedThreadName = name;
                        return { id: 'thread-123', send: async () => {} };
                    }
                }),
                user: { username: 'testuser' }
            };

            const mockHandleOCommand = createHandleOCommand({
                generateResponse: async () => 'テスト応答',
                getThreadHistory: () => [],
                addToThreadHistory: () => {},
                initializeThread: () => {},
                buildMaidThinkingMessage: () => '思考中...',
                sendSplitMessage: async () => {},
                generateThreadName: (prompt, username) => `custom-${username}-${prompt}`
            });

            await mockHandleOCommand(mockInteraction);

            assert.equal(capturedThreadName, 'custom-testuser-プロンプト');
        });
    });

    describe('attachments', () => {
        test('should include a loaded attachment in the response prompt without posting its contents', async () => {
            let generatedPrompt = null;
            const savedMessages = [];
            const threadMessages = [];
            const thread = {
                id: 'thread-attachment',
                send: async content => {
                    threadMessages.push(content);
                    return { edit: async () => {} };
                }
            };
            const mockInteraction = {
                options: {
                    getString: () => 'このコードを説明して',
                    getAttachment: () => ({ name: 'app.js' })
                },
                deferReply: async () => {},
                followUp: async () => ({ startThread: async () => thread }),
                user: { username: 'testuser' }
            };

            await createHandleOCommand({
                loadAttachmentText: async () => ({
                    ok: true,
                    name: 'app.js',
                    text: 'const secret = 42;',
                    truncated: false
                }),
                generateResponse: async prompt => {
                    generatedPrompt = prompt;
                    return 'テスト応答';
                },
                getThreadHistory: () => [],
                addToThreadHistory: (_threadId, message) => savedMessages.push(message),
                initializeThread: () => {},
                buildMaidThinkingMessage: () => '思考中...',
                sendSplitMessage: async () => {}
            })(mockInteraction);

            assert.match(generatedPrompt, /const secret = 42;/);
            assert.match(generatedPrompt, /ファイル内容は参照用のデータ/);
            assert.match(savedMessages[0].text, /\[添付ファイル: app\.js を参照\]/);
            assert.doesNotMatch(threadMessages[0].content, /const secret = 42;/);
            assert.match(threadMessages[0].content, /📎 添付: app\.js/);
        });

        test('should reject an invalid attachment before creating a thread', async () => {
            let threadCreated = false;
            const followUps = [];
            const mockInteraction = {
                options: {
                    getString: () => '画像を読んで',
                    getAttachment: () => ({ name: 'image.png' })
                },
                deferReply: async () => {},
                followUp: async content => {
                    followUps.push(content);
                    return {
                        startThread: async () => {
                            threadCreated = true;
                        }
                    };
                },
                user: { username: 'testuser' }
            };

            await createHandleOCommand({
                loadAttachmentText: async () => ({
                    ok: false,
                    reason: 'image',
                    message: '画像・動画・音声ファイルは対応しておりません。'
                })
            })(mockInteraction);

            assert.equal(threadCreated, false);
            assert.deepEqual(followUps, [
                {
                    content: '画像・動画・音声ファイルは対応しておりません。',
                    ephemeral: true
                }
            ]);
        });
    });

    describe('error handling', () => {
        test('should not send an error follow-up when a generation is aborted', async () => {
            const threadManager = await importFreshThreadManager();
            const followUps = [];
            const edits = [];
            let controller = null;
            let sendCount = 0;
            const thinkingMessage = {
                id: 'thinking-command-abort',
                edit: async content => edits.push(content),
                react: async () => {}
            };
            const thread = {
                id: 'thread-command-abort',
                send: async () => {
                    sendCount++;
                    return sendCount === 2 ? thinkingMessage : {};
                }
            };
            const interaction = {
                options: { getString: () => '中断する質問' },
                deferReply: async () => {},
                followUp: async content => {
                    followUps.push(content);
                    return { startThread: async () => thread };
                },
                user: { id: 'user-1', username: 'testuser' }
            };

            await createHandleOCommand({
                getThreadHistory: threadManager.getThreadHistory,
                addToThreadHistory: threadManager.addToThreadHistory,
                initializeThread: threadManager.initializeThread,
                setThreadHistory: threadManager.setThreadHistory,
                buildMaidThinkingMessage: () => '考え中…',
                sendSplitMessage: async () => {
                    assert.fail('aborted generation must not send a response');
                },
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
                }
            })(interaction);

            assert.deepEqual(edits, ['✖️ 中断しました。']);
            assert.equal(followUps.length, 1);
            assert.deepEqual(threadManager.getThreadHistory(thread.id), [
                { role: 'user', text: '中断する質問', speaker: 'testuser' }
            ]);
        });

        test('should handle errors gracefully', async () => {
            let errorFollowUpCalled = false;
            let errorFollowUpContent = null;

            const mockInteraction = {
                options: { getString: () => 'テストプロンプト' },
                deferReply: async () => {},
                followUp: async content => {
                    // 2回目のfollowUp（エラー時）をキャッチ
                    if (content?.content) {
                        errorFollowUpCalled = true;
                        errorFollowUpContent = content;
                    }
                    throw new Error('テストエラー');
                },
                user: { username: 'testuser' }
            };

            const mockHandleOCommand = createHandleOCommand({
                generateResponse: async () => 'テスト応答',
                getThreadHistory: async () => [],
                addToThreadHistory: async () => {},
                initializeThread: () => {},
                buildMaidThinkingMessage: () => '思考中...',
                sendSplitMessage: async () => {}
            });

            // エラーが投げられないことを確認（エラーハンドリングされる）
            await mockHandleOCommand(mockInteraction);

            assert.ok(errorFollowUpCalled, 'Should call followUp for error handling');
            assert.ok(
                errorFollowUpContent?.content?.includes('エラー'),
                'Should send error message'
            );
        });
    });

    describe('logging', () => {
        test('should log command lifecycle at info level', async () => {
            const originalConsoleInfo = console.info;
            const originalLogLevel = process.env.LOG_LEVEL;
            const infoLogs = [];

            console.info = (...args) => {
                infoLogs.push(args);
            };
            process.env.LOG_LEVEL = 'info';

            try {
                const thread = {
                    id: 'thread-log-1',
                    send: async () => ({ edit: async () => {} })
                };

                const mockInteraction = {
                    options: { getString: () => 'ログ確認' },
                    deferReply: async () => {},
                    followUp: async () => ({
                        startThread: async () => thread
                    }),
                    user: { id: 'user-1', username: 'testuser' }
                };

                const mockHandleOCommand = createHandleOCommand({
                    generateResponse: async () => 'ログ応答',
                    getThreadHistory: () => [],
                    addToThreadHistory: () => {},
                    initializeThread: () => {},
                    buildMaidThinkingMessage: () => '思考中...',
                    sendSplitMessage: async () => {}
                });

                await mockHandleOCommand(mockInteraction);
            } finally {
                console.info = originalConsoleInfo;
                if (originalLogLevel === undefined) {
                    delete process.env.LOG_LEVEL;
                } else {
                    process.env.LOG_LEVEL = originalLogLevel;
                }
            }

            const receivedLog = infoLogs.find(([message]) => message === 'Received /o command');
            const threadLog = infoLogs.find(
                ([message]) => message === 'Created response thread for /o command'
            );
            const completedLog = infoLogs.find(
                ([message]) => message === 'Completed /o command response'
            );

            assert.ok(receivedLog);
            assert.ok(threadLog);
            assert.ok(completedLog);
            assert.equal(receivedLog[1]?.scope, 'oCommand');
            assert.equal(receivedLog[1]?.userId, 'user-1');
            assert.equal(receivedLog[1]?.promptLength, 4);
            assert.equal(threadLog[1]?.threadId, 'thread-log-1');
            assert.equal(completedLog[1]?.responseLength, 4);
        });
    });
});
