import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_CONFIG_CANDIDATES = [
    path.resolve(MODULE_DIR, '../config/prompts.yml'),
    path.resolve(MODULE_DIR, '../config/prompts.yaml')
];

function loadPrompts() {
    const promptConfigPath = PROMPT_CONFIG_CANDIDATES.find(candidate => fs.existsSync(candidate));
    if (!promptConfigPath) {
        throw new Error(`No prompt config found in: ${PROMPT_CONFIG_CANDIDATES.join(', ')}`);
    }

    const file = fs.readFileSync(promptConfigPath, 'utf8');
    const prompts = yaml.load(file)?.prompts;

    if (!prompts || typeof prompts !== 'object') {
        throw new Error(`Prompt config must contain a "prompts" object: ${promptConfigPath}`);
    }

    return {
        system: requirePrompt(prompts, 'system', promptConfigPath),
        decision: requirePrompt(prompts, 'decision', promptConfigPath),
        searchNotices: requirePromptList(prompts, 'searchNotices', promptConfigPath),
        summary: optionalPrompt(prompts, 'summary'),
        threadName: optionalPrompt(prompts, 'threadName')
    };
}

// 任意キー。未定義・空の場合は undefined を返す
function optionalPrompt(prompts, key) {
    const prompt = prompts[key];
    if (typeof prompt !== 'string' || !prompt.trim()) {
        return undefined;
    }

    return prompt.trim();
}

function requirePrompt(prompts, key, promptConfigPath) {
    const prompt = prompts[key];
    if (typeof prompt !== 'string' || !prompt.trim()) {
        throw new Error(`Prompt "${key}" must be a non-empty string: ${promptConfigPath}`);
    }

    return prompt.trim();
}

function requirePromptList(prompts, key, promptConfigPath) {
    const list = prompts[key];
    if (!Array.isArray(list) || list.length === 0) {
        throw new Error(`Prompt "${key}" must be a non-empty array: ${promptConfigPath}`);
    }

    const trimmed = list.map(item => {
        if (typeof item !== 'string' || !item.trim()) {
            throw new Error(
                `Prompt "${key}" must contain only non-empty strings: ${promptConfigPath}`
            );
        }
        return item.trim();
    });

    return trimmed;
}

const prompts = loadPrompts();

export const SYSTEM_PROMPT = prompts.system;
export const decisionPrompt = prompts.decision;
export const searchNotices = prompts.searchNotices;
// 任意プロンプト（未設定の場合は ollamaClient.js 側のデフォルトにフォールバック）
export const SUMMARY_PROMPT =
    prompts.summary ??
    '以下の会話履歴を簡潔に要約してください。重要な事実・前提・未解決事項を保持してください。';
export const THREAD_NAME_PROMPT = prompts.threadName;
export { prompts };

// 検索済み通知をランダムに1件選択する
export function pickSearchNotice(randomFn = Math.random) {
    return searchNotices[Math.floor(randomFn() * searchNotices.length)];
}
