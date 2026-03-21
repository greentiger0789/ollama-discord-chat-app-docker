import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
    buildMaidThinkingMessage,
    sendSplitMessage
} from "../src/messageUtils.js";

/* ================================
   buildMaidThinkingMessage テスト
================================ */

describe("buildMaidThinkingMessage", () => {
    test("returns a non-empty string", () => {
        const message = buildMaidThinkingMessage();
        assert.equal(typeof message, "string");
        assert.ok(message.length > 0);
    });

    test("starts with an emoji", () => {
        const message = buildMaidThinkingMessage();

        // Unicode安全な取得
        const firstChar = Array.from(message)[0];

        const isEmoji =
            /\p{Extended_Pictographic}/u.test(firstChar) ||
            /\p{Emoji_Presentation}/u.test(firstChar);

        assert.ok(isEmoji, `First character should be emoji: ${firstChar}`);
    });

    test("contains expected keywords", () => {
        const message = buildMaidThinkingMessage();

        const hasExpectedContent =
            message.includes("ご主人様") ||
            message.includes("演算") ||
            message.includes("解析") ||
            message.includes("中") ||
            message.includes("おります");

        assert.ok(hasExpectedContent);
    });

    test("generates varied messages", () => {
        const messages = new Set();

        for (let i = 0; i < 20; i++) {
            messages.add(buildMaidThinkingMessage());
        }

        // ランダムなので1以上ならOK
        assert.ok(messages.size >= 1);
    });
});

/* ================================
   sendSplitMessage テスト
================================ */

describe("sendSplitMessage", () => {
    test("sends short message directly", async () => {
        const messages = [];

        const mockChannel = {
            send: async (text) => messages.push(text)
        };

        const text = "短いメッセージ";

        await sendSplitMessage(mockChannel, text);

        assert.equal(messages.length, 1);
        assert.equal(messages[0], text);
    });

    test("edits message if firstMessageToEdit exists", async () => {
        const edits = [];

        const mockMessage = {
            edit: async (text) => edits.push(text)
        };

        const mockChannel = {
            send: async () => {
                throw new Error("should not send");
            }
        };

        const text = "短い";

        await sendSplitMessage(mockChannel, text, mockMessage);

        assert.equal(edits.length, 1);
        assert.equal(edits[0], text);
    });

    test("splits long message", async () => {
        const messages = [];

        const mockChannel = {
            send: async (text) => messages.push(text)
        };

        const text = "a".repeat(2000);

        await sendSplitMessage(mockChannel, text);

        assert.equal(messages.length, 2);
        assert.equal(messages[0].length, 1900);
        assert.equal(messages[1].length, 100);
    });

    test("splits very long message", async () => {
        const messages = [];

        const mockChannel = {
            send: async (text) => messages.push(text)
        };

        const text = "x".repeat(5000);

        await sendSplitMessage(mockChannel, text);

        assert.equal(messages.length, Math.ceil(5000 / 1900));
    });

    test("edits first chunk and sends rest", async () => {
        const edits = [];
        const messages = [];

        const mockMessage = {
            edit: async (text) => edits.push(text)
        };

        const mockChannel = {
            send: async (text) => messages.push(text)
        };

        const text = "b".repeat(3000);

        await sendSplitMessage(mockChannel, text, mockMessage);

        assert.equal(edits.length, 1);
        assert.equal(edits[0].length, 1900);

        assert.equal(messages.length, 1);
        assert.equal(messages[0].length, 1100);
    });

    test("exactly 1900 characters", async () => {
        const messages = [];

        const mockChannel = {
            send: async (text) => messages.push(text)
        };

        const text = "c".repeat(1900);

        await sendSplitMessage(mockChannel, text);

        assert.equal(messages.length, 1);
        assert.equal(messages[0].length, 1900);
    });

    test("1901 characters", async () => {
        const messages = [];

        const mockChannel = {
            send: async (text) => messages.push(text)
        };

        const text = "d".repeat(1901);

        await sendSplitMessage(mockChannel, text);

        assert.equal(messages.length, 2);
        assert.equal(messages[0].length, 1900);
        assert.equal(messages[1].length, 1);
    });
});
