import { type ChildProcess, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR, readEnvFile } from './src/env.ts';

const CHILD_COMMAND = ['node', 'index.ts'] as const;
const POLL_INTERVAL_MS = 1000;
const MANIFEST_STATE_FILE = path.join(APP_DIR, 'node_modules', '.manifest.hash');
const LOCK_FILES = ['package-lock.json', 'npm-shrinkwrap.json'];
const MANIFEST_FILES = ['package.json', ...LOCK_FILES];
const WATCH_ROOTS = ['index.ts', 'tsconfig.json', '.env', ...MANIFEST_FILES, 'src', 'config'];

type Snapshot = Map<string, string>;

let childProcess: ChildProcess | null = null;
let isRestarting = false;
let isShuttingDown = false;
let currentSnapshot = createSnapshot();

function getWatchEntries(): string[] {
    const files: string[] = [];

    for (const relativePath of WATCH_ROOTS) {
        const absolutePath = path.join(APP_DIR, relativePath);

        if (!fs.existsSync(absolutePath)) {
            continue;
        }

        const stat = fs.statSync(absolutePath);

        if (stat.isDirectory()) {
            collectFiles(absolutePath, files);
            continue;
        }

        if (stat.isFile()) {
            files.push(absolutePath);
        }
    }

    return files.sort((a, b) => a.localeCompare(b));
}

function collectFiles(directoryPath: string, files: string[]): void {
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
        const absolutePath = path.join(directoryPath, entry.name);

        if (entry.isDirectory()) {
            collectFiles(absolutePath, files);
            continue;
        }

        if (entry.isFile()) {
            files.push(absolutePath);
        }
    }
}

function createSnapshot(): Snapshot {
    const files = new Map<string, string>();

    for (const absolutePath of getWatchEntries()) {
        const relativePath = path.relative(APP_DIR, absolutePath);
        const stat = fs.statSync(absolutePath);

        files.set(relativePath, `${stat.size}:${stat.mtimeMs}`);
    }

    return files;
}

function diffSnapshots(previousSnapshot: Snapshot, nextSnapshot: Snapshot): string[] {
    const changedPaths = new Set<string>();

    for (const [relativePath, signature] of previousSnapshot.entries()) {
        if (nextSnapshot.get(relativePath) !== signature) {
            changedPaths.add(relativePath);
        }
    }

    for (const [relativePath, signature] of nextSnapshot.entries()) {
        if (previousSnapshot.get(relativePath) !== signature) {
            changedPaths.add(relativePath);
        }
    }

    return [...changedPaths].sort((a, b) => a.localeCompare(b));
}

function computeManifestHash(): string {
    const hash = crypto.createHash('sha256');
    let hasManifest = false;

    for (const relativePath of MANIFEST_FILES) {
        const absolutePath = path.join(APP_DIR, relativePath);

        if (!fs.existsSync(absolutePath)) {
            continue;
        }

        hasManifest = true;
        hash.update(relativePath);
        hash.update('\0');
        hash.update(fs.readFileSync(absolutePath));
        hash.update('\0');
    }

    return hasManifest ? hash.digest('hex') : '';
}

function hasInstalledDependencies(): boolean {
    const nodeModulesPath = path.join(APP_DIR, 'node_modules');

    if (!fs.existsSync(nodeModulesPath)) {
        return false;
    }

    return fs.readdirSync(nodeModulesPath).length > 0;
}

function saveManifestHash(manifestHash: string): void {
    fs.mkdirSync(path.dirname(MANIFEST_STATE_FILE), { recursive: true });
    fs.writeFileSync(MANIFEST_STATE_FILE, `${manifestHash}\n`, 'utf8');
}

function loadManifestHash(): string {
    if (!fs.existsSync(MANIFEST_STATE_FILE)) {
        return '';
    }

    return fs.readFileSync(MANIFEST_STATE_FILE, 'utf8').trim();
}

function buildChildEnv(): NodeJS.ProcessEnv {
    return {
        ...process.env,
        ...readEnvFile()
    };
}

function runCommand(command: string, args: readonly string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const processRef = spawn(command, args, {
            cwd: APP_DIR,
            env: buildChildEnv(),
            stdio: 'inherit'
        });

        processRef.on('exit', (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(
                new Error(
                    `${command} ${args.join(' ')} failed with ${signal || `exit code ${code}`}`
                )
            );
        });

        processRef.on('error', reject);
    });
}

function hasLockFile(): boolean {
    return LOCK_FILES.some(relativePath => fs.existsSync(path.join(APP_DIR, relativePath)));
}

function getInstallCommandArgs(): string[] {
    return hasLockFile() ? ['ci'] : ['install'];
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function ensureDependencies(): Promise<boolean> {
    const manifestHash = computeManifestHash();

    if (!manifestHash) {
        return true;
    }

    if (!hasInstalledDependencies()) {
        console.log('[hot-reload] node_modules is missing. Installing dependencies...');

        try {
            await runCommand('npm', getInstallCommandArgs());
            saveManifestHash(manifestHash);
            return true;
        } catch (error) {
            console.error('[hot-reload] Failed to install dependencies:', getErrorMessage(error));
            return false;
        }
    }

    const previousHash = loadManifestHash();

    if (!previousHash) {
        saveManifestHash(manifestHash);
        return true;
    }

    if (previousHash === manifestHash) {
        return true;
    }

    console.log('[hot-reload] Dependency manifest changed. Reinstalling dependencies...');

    try {
        await runCommand('npm', getInstallCommandArgs());
        saveManifestHash(manifestHash);
        return true;
    } catch (error) {
        console.error('[hot-reload] Failed to reinstall dependencies:', getErrorMessage(error));
        return false;
    }
}

function startChild(): void {
    if (childProcess || isShuttingDown) {
        return;
    }

    const [command, ...args] = CHILD_COMMAND;
    childProcess = spawn(command, args, {
        cwd: APP_DIR,
        env: buildChildEnv(),
        stdio: 'inherit'
    });

    childProcess.on('exit', (code, signal) => {
        childProcess = null;

        if (isShuttingDown || isRestarting) {
            return;
        }

        const reason = signal || `exit code ${code}`;
        console.error(`[hot-reload] App stopped with ${reason}. Waiting for file changes...`);
    });

    childProcess.on('error', error => {
        childProcess = null;
        console.error('[hot-reload] Failed to start app:', error.message);
    });
}

function stopChild(): Promise<void> {
    return new Promise<void>(resolve => {
        if (!childProcess) {
            void resolve();
            return;
        }

        const processRef = childProcess;
        let settled = false;

        const finish = () => {
            if (settled) {
                return;
            }

            settled = true;
            void resolve();
        };

        processRef.once('exit', finish);
        processRef.kill('SIGTERM');

        setTimeout(() => {
            if (processRef.exitCode === null && processRef.signalCode === null) {
                processRef.kill('SIGKILL');
            }
        }, 5000);
    });
}

async function restartChild(changedPaths: string[]): Promise<void> {
    const summary = changedPaths.slice(0, 5).join(', ');
    const overflow = changedPaths.length > 5 ? ` (+${changedPaths.length - 5} more)` : '';
    const changedManifest = changedPaths.some(relativePath =>
        MANIFEST_FILES.includes(relativePath)
    );

    console.log(`[hot-reload] Change detected: ${summary}${overflow}`);

    isRestarting = true;

    try {
        if (changedManifest) {
            const ready = await ensureDependencies();

            if (!ready) {
                return;
            }
        }

        await stopChild();
        startChild();
    } finally {
        currentSnapshot = createSnapshot();
        isRestarting = false;
    }
}

async function boot(): Promise<void> {
    const ready = await ensureDependencies();

    if (ready) {
        startChild();
    } else {
        console.error('[hot-reload] Dependency setup failed. Waiting for file changes...');
    }

    setInterval(async () => {
        if (isShuttingDown || isRestarting) {
            return;
        }

        const nextSnapshot = createSnapshot();
        const changedPaths = diffSnapshots(currentSnapshot, nextSnapshot);

        if (changedPaths.length === 0) {
            return;
        }

        currentSnapshot = nextSnapshot;
        await restartChild(changedPaths);
    }, POLL_INTERVAL_MS);
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;
    console.log(`[hot-reload] Received ${signal}. Shutting down...`);
    await stopChild();
    process.exit(0);
}

process.on('SIGINT', () => {
    shutdown('SIGINT').catch(error => {
        console.error('[hot-reload] Shutdown failed:', getErrorMessage(error));
        process.exit(1);
    });
});

process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch(error => {
        console.error('[hot-reload] Shutdown failed:', getErrorMessage(error));
        process.exit(1);
    });
});

boot().catch(error => {
    console.error('[hot-reload] Failed to boot dev runner:', getErrorMessage(error));
    process.exit(1);
});
