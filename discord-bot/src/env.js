import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(MODULE_DIR, '..');
const ENV_CANDIDATES = [
    path.join(APP_DIR, '.env'),
    path.resolve(APP_DIR, '../.env')
];

export function resolveEnvPath() {
    return ENV_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || ENV_CANDIDATES[0];
}

export function readEnvFile() {
    const envPath = resolveEnvPath();

    if (!fs.existsSync(envPath)) {
        return {};
    }

    return dotenv.parse(fs.readFileSync(envPath, 'utf8'));
}

export function loadEnv({ override = false } = {}) {
    const envPath = resolveEnvPath();

    if (!fs.existsSync(envPath)) {
        return;
    }

    dotenv.config({ path: envPath, override, quiet: true });
}

export { APP_DIR };
