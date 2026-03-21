import axios from "axios";
import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";

// console.errorを抑制（モジュール読み込み前に設定）
let originalConsoleError;
before(() => {
    originalConsoleError = console.error;
    console.error = () => { };
});

after(() => {
    console.error = originalConsoleError;
});

// モック用の変数
let mockPostHandler;
let mockGetHandler;

// axiosモック
axios.create = () => ({
    post: (...args) => mockPostHandler(...args),
    get: (...args) => mockGetHandler(...args)
});

// テスト対象を動的インポート
let createOllamaClient;

before(async () => {
    const module = await import("../src/ollamaClient.js");
    createOllamaClient = module.default;
});

/* ================================
   基本応答テスト
================================ */

describe("generate() basic functionality", () => {
    test("should return assistant response", async () => {
        mockPostHandler = async () => ({
            data: {
                message: {
                    content: "これはテスト回答です"
                }
            }
        });
        mockGetHandler = async () => ({ data: {} });

        const client = createOllamaClient({
            baseURL: "http://mock-ollama"
        });

        const result = await client.generate({
            prompt: "こんにちは",
            history: []
        });

        assert.equal(result, "これはテスト回答です");
    });

    test("should work with empty prompt", async () => {
        mockPostHandler = async () => ({
            data: {
                message: {
                    content: "空のプロンプトへの応答"
                }
            }
        });

        const client = createOllamaClient();
        const result = await client.generate({ prompt: "", history: [] });

        assert.ok(typeof result === "string");
    });

    test("should work with empty history", async () => {
        mockPostHandler = async () => ({
            data: {
                message: {
                    content: "履歴なしの応答"
                }
            }
        });

        const client = createOllamaClient();
        const result = await client.generate({ prompt: "テスト" });

        assert.ok(typeof result === "string");
    });
});

/* ================================
   履歴処理テスト
================================ */

describe("generate() history handling", () => {
    test("should work with history", async () => {
        mockPostHandler = async () => ({
            data: {
                message: {
                    content: "履歴ありの応答"
                }
            }
        });

        const client = createOllamaClient();

        const result = await client.generate({
            prompt: "続けて",
            history: [
                { role: "user", text: "前の質問" },
                { role: "assistant", text: "前の回答" }
            ]
        });

        assert.ok(typeof result === "string");
    });

    test("should handle long history safely", async () => {
        mockPostHandler = async () => ({
            data: {
                message: {
                    content: "長文履歴の応答"
                }
            }
        });

        const longHistory = Array.from({ length: 50 }, (_, i) => ({
            role: i % 2 === 0 ? "user" : "assistant",
            text: "テスト".repeat(200)
        }));

        const client = createOllamaClient();

        const result = await client.generate({
            prompt: "長文テスト",
            history: longHistory
        });

        assert.ok(result.length > 0);
    });

    test("should handle history with empty text", async () => {
        mockPostHandler = async () => ({
            data: {
                message: {
                    content: "空テキスト履歴の応答"
                }
            }
        });

        const client = createOllamaClient();

        const result = await client.generate({
            prompt: "テスト",
            history: [
                { role: "user", text: "" },
                { role: "assistant", text: "回答" }
            ]
        });

        assert.ok(typeof result === "string");
    });
});

/* ================================
   検索判定テスト
================================ */

describe("generate() search decision", () => {
    test("should trigger search for force keywords", async () => {
        let searchCalled = false;

        // モック検索関数
        const mockSearchFn = async (plan) => {
            searchCalled = true;
            return "モック検索結果: 今日の天気は晴れです";
        };

        mockPostHandler = async (url, data) => {
            // 検索判定リクエスト
            if (data.messages && data.messages.length === 2) {
                return {
                    data: {
                        message: {
                            content: JSON.stringify({
                                needSearch: true,
                                engine: "tavily",
                                searchQuery: "今日の天気"
                            })
                        }
                    }
                };
            }
            // 検索結果を含む最終リクエスト
            if (data.messages && data.messages.length > 2) {
                return {
                    data: {
                        message: {
                            content: "検索結果を含む応答"
                        }
                    }
                };
            }
            return {
                data: {
                    message: {
                        content: "通常応答"
                    }
                }
            };
        };

        mockGetHandler = async () => ({
            data: {
                RelatedTopics: []
            }
        });

        const client = createOllamaClient({ searchFn: mockSearchFn });

        // 「今日」は強制検索キーワード
        const result = await client.generate({
            prompt: "今日の天気はどう？",
            history: []
        });

        assert.ok(searchCalled, "searchFn should be called for force keywords");
        assert.ok(typeof result === "string");
    });

    test("should not search for general questions", async () => {
        let searchCalled = false;

        // モック検索関数
        const mockSearchFn = async (plan) => {
            searchCalled = true;
            return "モック検索結果";
        };

        mockPostHandler = async () => ({
            data: {
                message: {
                    content: JSON.stringify({
                        needSearch: false,
                        engine: "tavily",
                        searchQuery: ""
                    })
                }
            }
        });

        const client = createOllamaClient({ searchFn: mockSearchFn });

        const result = await client.generate({
            prompt: "こんにちは",
            history: []
        });

        assert.ok(!searchCalled, "searchFn should not be called for general questions");
        assert.ok(typeof result === "string");
    });
});

/* ================================
   レスポンス形式テスト
================================ */

describe("generate() response formats", () => {
    test("should handle OpenAI-compatible response format", async () => {
        mockPostHandler = async () => ({
            data: {
                choices: [
                    {
                        message: {
                            content: "OpenAI形式の応答"
                        }
                    }
                ]
            }
        });

        const client = createOllamaClient();
        const result = await client.generate({
            prompt: "テスト",
            history: []
        });

        assert.equal(result, "OpenAI形式の応答");
    });

    test("should handle generate-compatible response format", async () => {
        mockPostHandler = async () => ({
            data: {
                response: "generate形式の応答"
            }
        });

        const client = createOllamaClient();
        const result = await client.generate({
            prompt: "テスト",
            history: []
        });

        assert.equal(result, "generate形式の応答");
    });

    test("should strip think tags from response", async () => {
        let callCount = 0;
        mockPostHandler = async () => {
            callCount++;
            // 1回目は検索判定、2回目は本推論
            if (callCount === 1) {
                return {
                    data: {
                        message: {
                            content: JSON.stringify({
                                needSearch: false,
                                engine: "tavily",
                                searchQuery: ""
                            })
                        }
                    }
                };
            }
            return {
                data: {
                    message: {
                        content: "<tool_call>これは思考内容です。<\/think>実際の応答"
                    }
                }
            };
        };

        const client = createOllamaClient();
        const result = await client.generate({
            prompt: "テスト",
            history: []
        });

        assert.ok(!result.includes("思考内容"));
        assert.ok(result.includes("実際の応答"));
    });

    test("should handle empty content after stripping think tags", async () => {
        mockPostHandler = async () => ({
            data: {
                message: {
                    content: "<tool_call>思考のみ...<tool_call>全て思考内容<\/think>"
                }
            }
        });

        const client = createOllamaClient();
        const result = await client.generate({
            prompt: "テスト",
            history: []
        });

        // 空になった場合は元のコンテンツを返すか、エラーメッセージを返す
        assert.ok(typeof result === "string");
    });
});

/* ================================
   エラーハンドリングテスト
================================ */

describe("generate() error handling", () => {
    test("should handle unknown response format", async () => {
        mockPostHandler = async () => ({
            data: {
                unknownField: "unknown"
            }
        });

        const client = createOllamaClient();
        const result = await client.generate({
            prompt: "テスト",
            history: []
        });

        assert.equal(result, "回答形式を解析できませんでした。");
    });

    test("should handle network error", async () => {
        mockPostHandler = async () => {
            throw new Error("Network error");
        };

        const client = createOllamaClient();

        try {
            await client.generate({
                prompt: "テスト",
                history: []
            });
            assert.fail("Should have thrown an error");
        } catch (err) {
            assert.ok(err.message.includes("Network error"));
        }
    });

    test("should handle error with response data", async () => {
        const error = new Error("API error");
        error.response = {
            data: "Error details from server"
        };

        mockPostHandler = async () => {
            throw error;
        };

        const client = createOllamaClient();

        // err.response.dataがある場合、streamToString()が呼ばれて
        // エラーメッセージとして返される（例外は投げられない）
        const result = await client.generate({
            prompt: "テスト",
            history: []
        });

        assert.equal(result, "Error details from server");
    });
});

/* ================================
   モデルオプションテスト
================================ */

describe("generate() model options", () => {
    test("should use default model when not specified", async () => {
        let capturedModel = null;

        mockPostHandler = async (url, data) => {
            capturedModel = data.model;
            return {
                data: {
                    message: {
                        content: "応答"
                    }
                }
            };
        };

        const client = createOllamaClient();
        await client.generate({
            prompt: "テスト",
            history: []
        });

        assert.equal(capturedModel, "qwen3.5:9b");
    });

    test("should use custom model when specified", async () => {
        let capturedModel = null;

        mockPostHandler = async (url, data) => {
            capturedModel = data.model;
            return {
                data: {
                    message: {
                        content: "応答"
                    }
                }
            };
        };

        const client = createOllamaClient();
        await client.generate({
            model: "custom-model",
            prompt: "テスト",
            history: []
        });

        assert.equal(capturedModel, "custom-model");
    });
});

/* ================================
   メッセージ構築テスト
================================ */

describe("generate() message construction", () => {
    test("should include system prompt in messages", async () => {
        let capturedMessages = null;

        mockPostHandler = async (url, data) => {
            capturedMessages = data.messages;
            return {
                data: {
                    message: {
                        content: "応答"
                    }
                }
            };
        };

        const client = createOllamaClient();
        await client.generate({
            prompt: "テスト",
            history: []
        });

        assert.ok(capturedMessages.length > 0);
        assert.equal(capturedMessages[0].role, "system");
        assert.ok(capturedMessages[0].content.includes("メイドちゃん"));
    });

    test("should map history roles correctly", async () => {
        let capturedMessages = null;

        mockPostHandler = async (url, data) => {
            capturedMessages = data.messages;
            return {
                data: {
                    message: {
                        content: "応答"
                    }
                }
            };
        };

        const client = createOllamaClient();
        await client.generate({
            prompt: "テスト",
            history: [
                { role: "user", text: "質問" },
                { role: "assistant", text: "回答" }
            ]
        });

        assert.equal(capturedMessages[1].role, "user");
        assert.equal(capturedMessages[1].content, "質問");
        assert.equal(capturedMessages[2].role, "assistant");
        assert.equal(capturedMessages[2].content, "回答");
    });
});
