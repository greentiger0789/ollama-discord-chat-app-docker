import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { decisionPrompt } from "../src/decisionPrompt.js";

describe("decisionPrompt", () => {
    test("should be exported as a string", () => {
        assert.equal(typeof decisionPrompt, "string");
    });

    test("should not be empty", () => {
        assert.ok(decisionPrompt.length > 0);
    });

    test("should contain search-related keywords", () => {
        const hasSearchKeywords =
            decisionPrompt.includes("検索") ||
            decisionPrompt.includes("search") ||
            decisionPrompt.includes("Web");
        assert.ok(hasSearchKeywords, "Should contain search-related keywords");
    });

    test("should mention tavily engine", () => {
        assert.ok(
            decisionPrompt.includes("tavily"),
            "Should mention tavily as a search engine option"
        );
    });

    test("should mention ddg engine", () => {
        assert.ok(
            decisionPrompt.includes("ddg"),
            "Should mention ddg (DuckDuckGo) as a search engine option"
        );
    });

    test("should contain JSON format specification", () => {
        assert.ok(
            decisionPrompt.includes("JSON"),
            "Should specify JSON output format"
        );
    });

    test("should contain needSearch field specification", () => {
        assert.ok(
            decisionPrompt.includes("needSearch"),
            "Should specify needSearch field"
        );
    });

    test("should contain engine field specification", () => {
        assert.ok(
            decisionPrompt.includes('"engine"'),
            "Should specify engine field"
        );
    });

    test("should contain searchQuery field specification", () => {
        assert.ok(
            decisionPrompt.includes("searchQuery"),
            "Should specify searchQuery field"
        );
    });

    test("should be properly trimmed (no leading/trailing whitespace)", () => {
        assert.equal(decisionPrompt, decisionPrompt.trim());
    });

    test("should contain role description as search strategist", () => {
        assert.ok(
            decisionPrompt.includes("検索戦略家") ||
            decisionPrompt.includes("検索"),
            "Should describe the role as search strategist"
        );
    });
});
