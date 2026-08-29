import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

import { decisionPrompt as legacyDecisionPrompt } from '../src/decisionPrompt.ts';
import {
    decisionPrompt,
    MULTI_USER_SYSTEM_PROMPT,
    pickSearchNotice,
    prompts,
    SUMMARY_PROMPT,
    SYSTEM_PROMPT,
    searchNotices
} from '../src/prompts.ts';
import { SYSTEM_PROMPT as legacySystemPrompt } from '../src/systemPrompt.ts';
import { assertRecord } from '../testing/fakes.ts';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_CONFIG_PATH = path.resolve(TEST_DIR, '../config/prompts.yml');

interface TestPromptConfig {
    prompts: Record<string, unknown> & {
        system: string;
        multiUserSystem: string;
        decision: string;
        searchNotices: string[];
    };
}

function loadPromptConfig(): TestPromptConfig {
    const config: unknown = yaml.load(fs.readFileSync(PROMPT_CONFIG_PATH, 'utf8'));
    assertRecord(config);
    assertRecord(config.prompts);
    const promptConfig = config.prompts;
    assert.ok(typeof promptConfig.system === 'string');
    assert.ok(typeof promptConfig.multiUserSystem === 'string');
    assert.ok(typeof promptConfig.decision === 'string');
    assert.ok(Array.isArray(promptConfig.searchNotices));
    const searchNotices = promptConfig.searchNotices.map(notice => {
        assert.equal(typeof notice, 'string');
        return notice;
    });

    return {
        prompts: {
            ...promptConfig,
            system: promptConfig.system,
            multiUserSystem: promptConfig.multiUserSystem,
            decision: promptConfig.decision,
            searchNotices
        }
    };
}

describe('prompt config', () => {
    test('should contain required prompt entries', () => {
        const config = loadPromptConfig();

        assert.ok(config?.prompts, 'prompts object should exist');
        assert.equal(typeof config.prompts.system, 'string');
        assert.equal(typeof config.prompts.decision, 'string');
    });

    test('should define non-empty trimmed prompt strings', () => {
        const config = loadPromptConfig();

        for (const [key, prompt] of Object.entries(config.prompts)) {
            if (Array.isArray(prompt)) {
                // リスト形式のプロンプト（例: searchNotices）
                assert.ok(prompt.length > 0, `${key} should not be empty`);
                for (const item of prompt) {
                    assert.equal(typeof item, 'string', `${key} items should be strings`);
                    assert.ok(item.trim().length > 0, `${key} items should not be empty`);
                    assert.equal(item, item.trim(), `${key} items should be trimmed`);
                }
                continue;
            }
            assert.equal(typeof prompt, 'string', `${key} prompt should be a string`);
            assert.ok(typeof prompt === 'string');
            assert.ok(prompt.trim().length > 0, `${key} prompt should not be empty`);
            assert.equal(prompt, prompt.trim(), `${key} prompt should be trimmed`);
        }
    });

    test('should preserve multiline prompt text from YAML block scalars', () => {
        const config = loadPromptConfig();

        assert.ok(config.prompts.system.includes('\n'), 'system prompt should be multiline');
        assert.ok(config.prompts.decision.includes('\n'), 'decision prompt should be multiline');
    });
});

describe('prompt exports', () => {
    test('should match trimmed values from prompts.yml', () => {
        const config = loadPromptConfig();

        assert.equal(SYSTEM_PROMPT, config.prompts.system.trim());
        assert.equal(MULTI_USER_SYSTEM_PROMPT, config.prompts.multiUserSystem.trim());
        assert.equal(decisionPrompt, config.prompts.decision.trim());
        assert.deepEqual(
            searchNotices,
            config.prompts.searchNotices.map(s => s.trim())
        );
    });

    test('should expose grouped prompts', () => {
        assert.deepEqual(prompts, {
            system: SYSTEM_PROMPT,
            multiUserSystem: MULTI_USER_SYSTEM_PROMPT,
            decision: decisionPrompt,
            searchNotices,
            summary: SUMMARY_PROMPT,
            threadName: undefined
        });
    });

    test('should expose summary prompt with fallback default', () => {
        assert.equal(typeof SUMMARY_PROMPT, 'string');
        assert.ok(SUMMARY_PROMPT.length > 0, 'SUMMARY_PROMPT should not be empty');
    });

    test('should preserve legacy prompt module compatibility', () => {
        assert.equal(legacySystemPrompt, SYSTEM_PROMPT);
        assert.equal(legacyDecisionPrompt, decisionPrompt);
    });

    test('should define search notices for web-search replies', () => {
        assert.ok(Array.isArray(searchNotices), 'searchNotices should be an array');
        assert.ok(searchNotices.length > 0, 'searchNotices should not be empty');
        for (const notice of searchNotices) {
            assert.ok(
                notice.includes('検索') || notice.includes('情報'),
                `notice should mention search: ${notice}`
            );
            assert.ok(!notice.includes('ご主人様'), 'notice should not include the greeting');
        }
    });

    test('should pick a notice from searchNotices', () => {
        const picked = pickSearchNotice();
        assert.ok(searchNotices.includes(picked), 'picked notice should be one of searchNotices');
    });

    test('should respect custom random function', () => {
        const first = searchNotices[0];
        assert.equal(
            pickSearchNotice(() => 0),
            first
        );
    });
});
