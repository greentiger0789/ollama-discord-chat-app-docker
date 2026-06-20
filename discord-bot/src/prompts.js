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
        decision: requirePrompt(prompts, 'decision', promptConfigPath)
    };
}

function requirePrompt(prompts, key, promptConfigPath) {
    const prompt = prompts[key];
    if (typeof prompt !== 'string' || !prompt.trim()) {
        throw new Error(`Prompt "${key}" must be a non-empty string: ${promptConfigPath}`);
    }

    return prompt.trim();
}

const prompts = loadPrompts();

export const SYSTEM_PROMPT = prompts.system;
export const decisionPrompt = prompts.decision;
export { prompts };
