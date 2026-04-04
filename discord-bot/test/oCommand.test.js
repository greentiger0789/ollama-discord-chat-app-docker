import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";

async function importFreshThreadManager() {
    const modulePath = new URL("../src/threadManager.js", import.meta.url);
    return await import(`${modulePath.href}?t=${Date.now()}-${Math.random()}`);
}

describe("oCommand", () => {
    let createHandleOCommand;
    let handleOCommand;
    let originalConsoleError;

    before(async () => {
        // console.errorをモックしてエラーログを抑制
        originalConsoleError = console.error;
        console.error = () => { };

        const module = await import("../src/commands/oCommand.js");
        createHandleOCommand = module.createHandleOCommand;
        handleOCommand = module.handleOCommand;
    });

    after(() => {
        console.error = originalConsoleError;
    });

    describe("handleOCommand structure", () => {
        test("should export handleOCommand function", () => {
            assert.equal(
                typeof handleOCommand,
                "function",
                "Should export handleOCommand as a function"
            );
        });

        test("handleOCommand should be async", () => {
            assert.ok(
                handleOCommand.constructor.name === "AsyncFunction" ||
                handleOCommand.toString().includes("async"),
                "handleOCommand should be an async function"
            );
        });

        test("should export createHandleOCommand factory", () => {
            assert.equal(
                typeof createHandleOCommand,
                "function",
                "Should export createHandleOCommand as a function"
            );
        });
    });

    describe("handleOCommand with mock interaction", () => {
        test("should defer reply", async () => {
            let deferCalled = false;
            const mockInteraction = {
                options: { getString: () => "テストプロンプト" },
                deferReply: async () => { deferCalled = true; },
                followUp: async () => ({
                    startThread: async () => ({ id: "thread-123", send: async () => { } })
                }),
                user: { username: "testuser" }
            };

            // モック依存関係
            const mockHandleOCommand = createHandleOCommand({
                generateResponse: async () => "テスト応答",
                getThreadHistory: async () => [],
                addToThreadHistory: async () => { },
                initializeThread: () => { },
                buildMaidThinkingMessage: () => "思考中...",
                sendSplitMessage: async () => { },
            });

            await mockHandleOCommand(mockInteraction);
            assert.ok(deferCalled, "deferReply should be called");
        });

        test("should get prompt from interaction options", async () => {
            let capturedPrompt = null;
            const mockInteraction = {
                options: {
                    getString: (name) => {
                        if (name === "prompt") {
                            capturedPrompt = "テスト用プロンプト";
                            return capturedPrompt;
                        }
                        return null;
                    }
                },
                deferReply: async () => { },
                followUp: async () => ({
                    startThread: async () => ({ id: "thread-123", send: async () => { } })
                }),
                user: { username: "testuser" }
            };

            const mockHandleOCommand = createHandleOCommand({
                generateResponse: async () => "テスト応答",
                getThreadHistory: async () => [],
                addToThreadHistory: async () => { },
                initializeThread: () => { },
                buildMaidThinkingMessage: () => "思考中...",
                sendSplitMessage: async () => { },
            });

            await mockHandleOCommand(mockInteraction);
            assert.equal(capturedPrompt, "テスト用プロンプト", "Should get prompt from interaction options");
        });

        test("should pass only prior history to generateResponse and persist the full exchange", async () => {
            const threadManager = await importFreshThreadManager();
            let capturedHistory = null;

            const thread = {
                id: "thread-history-1",
                send: async () => ({ edit: async () => { } })
            };

            const mockInteraction = {
                options: { getString: () => "初回プロンプト" },
                deferReply: async () => { },
                followUp: async () => ({
                    startThread: async () => thread
                }),
                user: { username: "testuser" }
            };

            const mockHandleOCommand = createHandleOCommand({
                generateResponse: async (_prompt, history) => {
                    capturedHistory = history;
                    return "テスト応答";
                },
                getThreadHistory: threadManager.getThreadHistory,
                addToThreadHistory: threadManager.addToThreadHistory,
                initializeThread: threadManager.initializeThread,
                buildMaidThinkingMessage: () => "思考中...",
                sendSplitMessage: async () => { },
            });

            await mockHandleOCommand(mockInteraction);

            assert.deepEqual(capturedHistory, []);
            assert.deepEqual(threadManager.getThreadHistory(thread.id), [
                { role: "user", text: "初回プロンプト" },
                { role: "assistant", text: "テスト応答" }
            ]);
        });
    });

    describe("error handling", () => {
        test("should handle errors gracefully", async () => {
            let errorFollowUpCalled = false;
            let errorFollowUpContent = null;

            const mockInteraction = {
                options: { getString: () => "テストプロンプト" },
                deferReply: async () => { },
                followUp: async (content) => {
                    // 2回目のfollowUp（エラー時）をキャッチ
                    if (content && content.content) {
                        errorFollowUpCalled = true;
                        errorFollowUpContent = content;
                    }
                    throw new Error("テストエラー");
                },
                user: { username: "testuser" }
            };

            const mockHandleOCommand = createHandleOCommand({
                generateResponse: async () => "テスト応答",
                getThreadHistory: async () => [],
                addToThreadHistory: async () => { },
                initializeThread: () => { },
                buildMaidThinkingMessage: () => "思考中...",
                sendSplitMessage: async () => { },
            });

            // エラーが投げられないことを確認（エラーハンドリングされる）
            await mockHandleOCommand(mockInteraction);

            assert.ok(errorFollowUpCalled, "Should call followUp for error handling");
            assert.ok(
                errorFollowUpContent && errorFollowUpContent.content && errorFollowUpContent.content.includes("エラー"),
                "Should send error message"
            );
        });
    });
});
