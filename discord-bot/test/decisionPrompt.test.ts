import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { decisionPrompt } from '../src/decisionPrompt.ts';

describe('decisionPrompt', () => {
    test('should be exported as a string', () => {
        assert.equal(typeof decisionPrompt, 'string');
    });

    test('should not be empty', () => {
        assert.ok(decisionPrompt.length > 0);
    });

    test('should contain search-related keywords', () => {
        const hasSearchKeywords =
            decisionPrompt.includes('検索') ||
            decisionPrompt.includes('search') ||
            decisionPrompt.includes('Web');
        assert.ok(hasSearchKeywords, 'Should contain search-related keywords');
    });

    test('should prioritize explicit web search requests', () => {
        assert.match(decisionPrompt, /明示的に依頼/);
        assert.match(decisionPrompt, /必ず needSearch を true/);
    });

    test('should cover key decision boundaries with generic examples', () => {
        assert.match(decisionPrompt, /〈作品名〉 〈登場人物名〉 一人称/);
        assert.match(decisionPrompt, /〈新製品名〉 仕様 旧モデル 比較 発表/);
        assert.match(decisionPrompt, /〈専門用語〉 提唱者 初出/);
        assert.match(decisionPrompt, /富士山の高さ/);
        assert.match(decisionPrompt, /文章を敬語に直して/);
    });

    test('should mention tavily engine', () => {
        assert.ok(
            decisionPrompt.includes('tavily'),
            'Should mention tavily as a search engine option'
        );
    });

    test('should mention ddg engine', () => {
        assert.ok(
            decisionPrompt.includes('ddg'),
            'Should mention ddg (DuckDuckGo) as a search engine option'
        );
    });

    test('should contain JSON format specification', () => {
        assert.ok(decisionPrompt.includes('JSON'), 'Should specify JSON output format');
    });

    test('should contain needSearch field specification', () => {
        assert.ok(decisionPrompt.includes('needSearch'), 'Should specify needSearch field');
    });

    test('should contain engine field specification', () => {
        assert.ok(decisionPrompt.includes('"engine"'), 'Should specify engine field');
    });

    test('should contain searchQuery field specification', () => {
        assert.ok(decisionPrompt.includes('searchQuery'), 'Should specify searchQuery field');
    });

    test('should be properly trimmed (no leading/trailing whitespace)', () => {
        assert.equal(decisionPrompt, decisionPrompt.trim());
    });

    test('should contain role description as search strategist', () => {
        assert.ok(
            decisionPrompt.includes('検索戦略家') || decisionPrompt.includes('検索'),
            'Should describe the role as search strategist'
        );
    });
});
