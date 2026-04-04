import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";
import { handleThreadMessage } from "../src/handlers/threadMessageHandler.js";

async function importFreshThreadManager() {
    const modulePath = new URL("../src/threadManager.js", import.meta.url);
    return await import(`${modulePath.href}?t=${Date.now()}-${Math.random()}`);
}

describe("threadMessageHandler", () => {
    let originalConsoleError;

    before(() => {
        originalConsoleError = console.error;
        console.error = () => { };
    });

    after(() => {
        console.error = originalConsoleError;
    });

    describe("handleThreadMessage structure", () => {
        test("should export handleThreadMessage function", () => {
            assert.equal(
                typeof handleThreadMessage,
                "function",
                "Should export handleThreadMessage as a function"
            );
        });

        test("handleThreadMessage should be async", () => {
            assert.ok(
                handleThreadMessage.constructor.name === "AsyncFunction" ||
                handleThreadMessage.toString().includes("async"),
                "handleThreadMessage should be an async function"
            );
        });
    });

    describe("handleThreadMessage with mock message", () => {
        test("should return early for non-thread channels", async () => {
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
                    return "🧹 考え中...";
                },
                sendSplitMessage: async () => { },
                generateResponse: async () => {
                    generateResponseCalled = true;
                    return "テスト応答";
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
            assert.equal(buildMaidThinkingMessageCalled, false, "Should not call buildMaidThinkingMessage");
            assert.equal(generateResponseCalled, false, "Should not call generateResponse");
            assert.equal(addToThreadHistoryCalled, false, "Should not call addToThreadHistory");
            assert.equal(getThreadHistoryCalled, false, "Should not call getThreadHistory");
        });

        test("should return early for bot messages", async () => {
            let sendCalled = false;
            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: "thread-123",
                    send: async () => {
                        sendCalled = true;
                        return { edit: async () => { } };
                    }
                },
                author: {
                    bot: true
                },
                content: "テストメッセージ"
            };

            let generateResponseCalled = false;

            const deps = {
                buildMaidThinkingMessage: () => "🧹 考え中...",
                sendSplitMessage: async () => { },
                generateResponse: async () => {
                    generateResponseCalled = true;
                    return "テスト応答";
                },
                addToThreadHistory: () => { },
                getThreadHistory: () => []
            };

            await handleThreadMessage(mockMessage, deps);

            // ボットメッセージでは依存関係が呼ばれないことを確認
            assert.equal(sendCalled, false, "Should not call channel.send for bot messages");
            assert.equal(generateResponseCalled, false, "Should not call generateResponse for bot messages");
        });

        test("should process valid thread messages with all dependencies", async () => {
            let buildMaidThinkingMessageCalled = false;
            let sendSplitMessageCalled = false;
            let generateResponseCalled = false;
            let addToThreadHistoryCalled = false;
            let getThreadHistoryCalled = false;

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: "thread-123",
                    send: async () => ({ edit: async () => { } })
                },
                author: {
                    bot: false
                },
                content: "テストメッセージ"
            };

            const deps = {
                buildMaidThinkingMessage: () => {
                    buildMaidThinkingMessageCalled = true;
                    return "🧹 考え中...";
                },
                sendSplitMessage: async () => {
                    sendSplitMessageCalled = true;
                },
                generateResponse: async () => {
                    generateResponseCalled = true;
                    return "テスト応答";
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

            assert.equal(buildMaidThinkingMessageCalled, true, "Should call buildMaidThinkingMessage");
            assert.equal(sendSplitMessageCalled, true, "Should call sendSplitMessage");
            assert.equal(generateResponseCalled, true, "Should call generateResponse");
            assert.equal(addToThreadHistoryCalled, true, "Should call addToThreadHistory");
            assert.equal(getThreadHistoryCalled, true, "Should call getThreadHistory");
        });

        test("should pass correct arguments to dependencies", async () => {
            let capturedThreadId = null;
            let capturedHistory = null;
            let capturedUserMessage = null;
            let capturedAssistantMessage = null;

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: "thread-456",
                    send: async () => ({ edit: async () => { } })
                },
                author: {
                    bot: false
                },
                content: "ユーザーメッセージ"
            };

            const deps = {
                buildMaidThinkingMessage: () => "🧹 考え中...",
                sendSplitMessage: async () => { },
                generateResponse: async (content, history) => {
                    capturedHistory = history;
                    return "アシスタント応答";
                },
                addToThreadHistory: (threadId, message) => {
                    capturedThreadId = threadId;
                    if (message.role === "user") {
                        capturedUserMessage = message;
                    } else {
                        capturedAssistantMessage = message;
                    }
                },
                getThreadHistory: () => []
            };

            await handleThreadMessage(mockMessage, deps);

            assert.equal(capturedThreadId, "thread-456", "Should pass correct thread ID");
            assert.deepEqual(capturedUserMessage, { role: "user", text: "ユーザーメッセージ" }, "Should add user message to history");
            assert.deepEqual(capturedAssistantMessage, { role: "assistant", text: "アシスタント応答" }, "Should add assistant message to history");
        });
    });

    describe("error handling", () => {
        test("should handle generateResponse errors gracefully", async () => {
            let sendCalled = false;
            let sentContent = null;

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: "thread-789",
                    send: async (content) => {
                        sendCalled = true;
                        sentContent = content;
                        return { edit: async () => { } };
                    }
                },
                author: {
                    bot: false
                },
                content: "エラーテスト"
            };

            const deps = {
                buildMaidThinkingMessage: () => "🧹 考え中...",
                sendSplitMessage: async () => { },
                generateResponse: async () => {
                    throw new Error("生成エラー");
                },
                addToThreadHistory: () => { },
                getThreadHistory: () => []
            };

            // エラーがスローされないことを確認
            await handleThreadMessage(mockMessage, deps);

            // エラーハンドリングでsendが呼ばれることを確認
            assert.equal(sendCalled, true, "Should call channel.send for error handling");
            assert.ok(sentContent && sentContent.includes("エラー"), "Should send error message");
        });

        test("should handle sendSplitMessage errors gracefully", async () => {
            const sentContents = [];

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: "thread-error",
                    send: async (content) => {
                        sentContents.push(content);
                        return { edit: async () => { } };
                    }
                },
                author: {
                    bot: false
                },
                content: "エラーテスト"
            };

            const deps = {
                buildMaidThinkingMessage: () => "🧹 考え中...",
                sendSplitMessage: async () => {
                    throw new Error("送信エラー");
                },
                generateResponse: async () => "テスト応答",
                addToThreadHistory: () => { },
                getThreadHistory: () => []
            };

            // エラーがスローされないことを確認
            await handleThreadMessage(mockMessage, deps);

            assert.equal(sentContents.length, 2, "Should send both the thinking message and the error message");
            assert.equal(sentContents[0], "🧹 考え中...", "Should send the thinking message first");
            assert.ok(
                typeof sentContents[1] === "string" && sentContents[1].includes("エラー"),
                "Should send an error message after sendSplitMessage fails"
            );
        });
    });

    describe("thread history integration", () => {
        test("should call getThreadHistory with correct thread ID", async () => {
            let capturedThreadId = null;

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: "thread-history-1",
                    send: async () => ({ edit: async () => { } })
                },
                author: {
                    bot: false
                },
                content: "履歴テスト"
            };

            const deps = {
                buildMaidThinkingMessage: () => "🧹 考え中...",
                sendSplitMessage: async () => { },
                generateResponse: async () => "テスト応答",
                addToThreadHistory: () => { },
                getThreadHistory: (threadId) => {
                    capturedThreadId = threadId;
                    return [];
                }
            };

            await handleThreadMessage(mockMessage, deps);

            assert.equal(capturedThreadId, "thread-history-1", "Should call getThreadHistory with correct thread ID");
        });

        test("should pass history to generateResponse", async () => {
            let capturedHistory = null;
            const existingHistory = [
                { role: "user", text: "以前のメッセージ" },
                { role: "assistant", text: "以前の応答" }
            ];

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: "thread-history-2",
                    send: async () => ({ edit: async () => { } })
                },
                author: {
                    bot: false
                },
                content: "新しいメッセージ"
            };

            const deps = {
                buildMaidThinkingMessage: () => "🧹 考え中...",
                sendSplitMessage: async () => { },
                generateResponse: async (content, history) => {
                    capturedHistory = history;
                    return "新しい応答";
                },
                addToThreadHistory: () => { },
                getThreadHistory: () => existingHistory
            };

            await handleThreadMessage(mockMessage, deps);

            assert.deepEqual(capturedHistory, existingHistory, "Should pass existing history to generateResponse");
        });

        test("should add messages to history in correct order", async () => {
            const addedMessages = [];

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: "thread-history-3",
                    send: async () => ({ edit: async () => { } })
                },
                author: {
                    bot: false
                },
                content: "順序テスト"
            };

            const deps = {
                buildMaidThinkingMessage: () => "🧹 考え中...",
                sendSplitMessage: async () => { },
                generateResponse: async () => "順序応答",
                addToThreadHistory: (threadId, message) => {
                    addedMessages.push(message);
                },
                getThreadHistory: () => []
            };

            await handleThreadMessage(mockMessage, deps);

            assert.equal(addedMessages.length, 2, "Should add two messages to history");
            assert.deepEqual(addedMessages[0], { role: "user", text: "順序テスト" }, "First message should be user message");
            assert.deepEqual(addedMessages[1], { role: "assistant", text: "順序応答" }, "Second message should be assistant message");
        });

        test("should pass only prior history to generateResponse when using the real thread manager", async () => {
            const threadManager = await importFreshThreadManager();
            const threadId = "thread-history-real";
            let capturedHistory = null;

            threadManager.initializeThread(threadId, "以前のメッセージ");
            threadManager.addToThreadHistory(threadId, {
                role: "assistant",
                text: "以前の応答"
            });

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: threadId,
                    send: async () => ({ edit: async () => { } })
                },
                author: {
                    bot: false
                },
                content: "新しいメッセージ"
            };

            const deps = {
                buildMaidThinkingMessage: () => "🧹 考え中...",
                sendSplitMessage: async () => { },
                generateResponse: async (_content, history) => {
                    capturedHistory = history;
                    return "新しい応答";
                },
                addToThreadHistory: threadManager.addToThreadHistory,
                getThreadHistory: threadManager.getThreadHistory
            };

            await handleThreadMessage(mockMessage, deps);

            assert.deepEqual(capturedHistory, [
                { role: "user", text: "以前のメッセージ" },
                { role: "assistant", text: "以前の応答" }
            ]);
            assert.deepEqual(threadManager.getThreadHistory(threadId), [
                { role: "user", text: "以前のメッセージ" },
                { role: "assistant", text: "以前の応答" },
                { role: "user", text: "新しいメッセージ" },
                { role: "assistant", text: "新しい応答" }
            ]);
        });
    });

    describe("message flow", () => {
        test("should call buildMaidThinkingMessage and send thinking message", async () => {
            let sentContent = null;

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: "thread-flow-1",
                    send: async (content) => {
                        sentContent = content;
                        return { edit: async () => { } };
                    }
                },
                author: {
                    bot: false
                },
                content: "フローテスト"
            };

            const deps = {
                buildMaidThinkingMessage: () => "🧹 考え中...",
                sendSplitMessage: async () => { },
                generateResponse: async () => "フロー応答",
                addToThreadHistory: () => { },
                getThreadHistory: () => []
            };

            await handleThreadMessage(mockMessage, deps);

            assert.equal(sentContent, "🧹 考え中...", "Should send thinking message");
        });

        test("should call sendSplitMessage with response", async () => {
            let capturedChannel = null;
            let capturedResponse = null;
            let capturedThinkingMsg = null;

            const thinkingMsg = { edit: async () => { } };

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: "thread-flow-2",
                    send: async () => thinkingMsg
                },
                author: {
                    bot: false
                },
                content: "フローテスト2"
            };

            const deps = {
                buildMaidThinkingMessage: () => "🧹 考え中...",
                sendSplitMessage: async (channel, response, msg) => {
                    capturedChannel = channel;
                    capturedResponse = response;
                    capturedThinkingMsg = msg;
                },
                generateResponse: async () => "フロー応答2",
                addToThreadHistory: () => { },
                getThreadHistory: () => []
            };

            await handleThreadMessage(mockMessage, deps);

            assert.equal(capturedChannel, mockMessage.channel, "Should pass channel to sendSplitMessage");
            assert.equal(capturedResponse, "フロー応答2", "Should pass response to sendSplitMessage");
            assert.equal(capturedThinkingMsg, thinkingMsg, "Should pass thinking message to sendSplitMessage");
        });
    });

    describe("generateResponse integration", () => {
        test("should pass user message content to generateResponse", async () => {
            let capturedContent = null;

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: "thread-gen-1",
                    send: async () => ({ edit: async () => { } })
                },
                author: {
                    bot: false
                },
                content: "生成テスト"
            };

            const deps = {
                buildMaidThinkingMessage: () => "🧹 考え中...",
                sendSplitMessage: async () => { },
                generateResponse: async (content) => {
                    capturedContent = content;
                    return "生成応答";
                },
                addToThreadHistory: () => { },
                getThreadHistory: () => []
            };

            await handleThreadMessage(mockMessage, deps);

            assert.equal(capturedContent, "生成テスト", "Should pass user message content to generateResponse");
        });

        test("should use response from generateResponse in history", async () => {
            const addedMessages = [];

            const mockMessage = {
                channel: {
                    isThread: () => true,
                    id: "thread-gen-2",
                    send: async () => ({ edit: async () => { } })
                },
                author: {
                    bot: false
                },
                content: "生成テスト2"
            };

            const deps = {
                buildMaidThinkingMessage: () => "🧹 考え中...",
                sendSplitMessage: async () => { },
                generateResponse: async () => "カスタム応答",
                addToThreadHistory: (threadId, message) => {
                    addedMessages.push(message);
                },
                getThreadHistory: () => []
            };

            await handleThreadMessage(mockMessage, deps);

            assert.equal(addedMessages[1].text, "カスタム応答", "Should use generateResponse result in history");
        });
    });
});
