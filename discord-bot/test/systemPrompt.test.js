import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { SYSTEM_PROMPT } from "../src/systemPrompt.js";

describe("SYSTEM_PROMPT", () => {
    test("should be exported as a string", () => {
        assert.equal(typeof SYSTEM_PROMPT, "string");
    });

    test("should not be empty", () => {
        assert.ok(SYSTEM_PROMPT.length > 0);
    });

    test("should contain character name 'メイドちゃん'", () => {
        assert.ok(
            SYSTEM_PROMPT.includes("メイドちゃん"),
            "Should contain character name 'メイドちゃん'"
        );
    });

    test("should contain reference to 'ご主人様'", () => {
        assert.ok(
            SYSTEM_PROMPT.includes("ご主人様"),
            "Should reference 'ご主人様' as the user"
        );
    });

    test("should specify first-person pronoun", () => {
        assert.ok(
            SYSTEM_PROMPT.includes("一人称") ||
            SYSTEM_PROMPT.includes("メイドちゃん"),
            "Should specify first-person pronoun"
        );
    });

    test("should mention polite speech style", () => {
        const hasPoliteSpeech =
            SYSTEM_PROMPT.includes("丁寧語") ||
            SYSTEM_PROMPT.includes("です") ||
            SYSTEM_PROMPT.includes("ます");
        assert.ok(hasPoliteSpeech, "Should mention polite speech style");
    });

    test("should mention emoji usage", () => {
        assert.ok(
            SYSTEM_PROMPT.includes("絵文字") ||
            SYSTEM_PROMPT.includes("emoji"),
            "Should mention emoji usage"
        );
    });

    test("should contain personality description", () => {
        assert.ok(
            SYSTEM_PROMPT.includes("性格") ||
            SYSTEM_PROMPT.includes("character") ||
            SYSTEM_PROMPT.includes("献身的"),
            "Should contain personality description"
        );
    });

    test("should mention logical thinking", () => {
        assert.ok(
            SYSTEM_PROMPT.includes("論理") ||
            SYSTEM_PROMPT.includes("logical"),
            "Should mention logical thinking"
        );
    });

    test("should be properly trimmed", () => {
        assert.equal(SYSTEM_PROMPT, SYSTEM_PROMPT.trim());
    });

    test("should contain absolute rules section", () => {
        assert.ok(
            SYSTEM_PROMPT.includes("絶対ルール") ||
            SYSTEM_PROMPT.includes("絶対に"),
            "Should contain absolute rules section"
        );
    });

    test("should mention token limit (num_predict)", () => {
        assert.ok(
            SYSTEM_PROMPT.includes("num_predict") ||
            SYSTEM_PROMPT.includes("8192"),
            "Should mention num_predict token limit"
        );
    });

    test("should prohibit meta-comments", () => {
        assert.ok(
            SYSTEM_PROMPT.includes("メタ発言") ||
            SYSTEM_PROMPT.includes("メタ"),
            "Should prohibit meta-comments"
        );
    });
});
