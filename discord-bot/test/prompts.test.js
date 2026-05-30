import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { decisionPrompt as legacyDecisionPrompt } from '../src/decisionPrompt.js';
import { decisionPrompt, prompts, SYSTEM_PROMPT } from '../src/prompts.js';
import { SYSTEM_PROMPT as legacySystemPrompt } from '../src/systemPrompt.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_CONFIG_PATH = path.resolve(TEST_DIR, '../config/prompts.yml');

function loadPromptConfig() {
    return yaml.load(fs.readFileSync(PROMPT_CONFIG_PATH, 'utf8'));
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
            assert.equal(typeof prompt, 'string', `${key} prompt should be a string`);
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
        assert.equal(decisionPrompt, config.prompts.decision.trim());
    });

    test('should expose grouped prompts', () => {
        assert.deepEqual(prompts, {
            system: SYSTEM_PROMPT,
            decision: decisionPrompt
        });
    });

    test('should preserve legacy prompt module compatibility', () => {
        assert.equal(legacySystemPrompt, SYSTEM_PROMPT);
        assert.equal(legacyDecisionPrompt, decisionPrompt);
    });
});
