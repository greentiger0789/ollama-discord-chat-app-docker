import axios from "axios";
import assert from "node:assert/strict";
import test from "node:test";

import createOllamaClient from "../src/ollamaClient.js";

/* ================================
   axios モック
================================ */

const mockPost = async () => ({
    data: {
        message: {
            content: "これはテスト回答です"
        }
    }
});

axios.create = () => ({
    post: mockPost
});

/* ================================
   基本応答テスト
================================ */

test("generate() should return assistant response", async () => {

    const client = createOllamaClient({
        baseURL: "http://mock-ollama"
    });

    const result = await client.generate({
        prompt: "こんにちは",
        history: []
    });

    assert.equal(result, "これはテスト回答です");
});

/* ================================
   履歴ありテスト
================================ */

test("generate() works with history", async () => {

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

/* ================================
   長文履歴テスト
================================ */

test("generate() handles long history safely", async () => {

    const longHistory = Array.from({ length: 50 }, (_, i) => ({
        role: "user",
        text: "テスト".repeat(200)
    }));

    const client = createOllamaClient();

    const result = await client.generate({
        prompt: "長文テスト",
        history: longHistory
    });

    assert.ok(result.length > 0);
});
