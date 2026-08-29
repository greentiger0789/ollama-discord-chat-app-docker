const LOG_LEVEL_PRIORITY = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    silent: 50
} as const;

export type LogLevel = keyof typeof LOG_LEVEL_PRIORITY;
export type LogMetadata = unknown;

export interface Logger {
    debug(message: string, meta?: LogMetadata): void;
    info(message: string, meta?: LogMetadata): void;
    warn(message: string, errOrMeta?: unknown, meta?: LogMetadata): void;
    error(message: string, errOrMeta?: unknown, meta?: LogMetadata): void;
}

function isTestEnvironment(): boolean {
    return (
        process.execArgv.includes('--test') ||
        process.argv.includes('--test') ||
        process.env.NODE_ENV === 'test'
    );
}

function normalizeLogLevel(level: unknown): LogLevel | null {
    const normalized = String(level || '').toLowerCase();
    switch (normalized) {
        case 'debug':
        case 'info':
        case 'warn':
        case 'error':
        case 'silent':
            return normalized;
        default:
            return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getConfiguredLogLevel(): LogLevel {
    return normalizeLogLevel(process.env.LOG_LEVEL) || (isTestEnvironment() ? 'warn' : 'info');
}

function shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[getConfiguredLogLevel()];
}

function buildContext(scope: string, meta: unknown): Record<string, unknown> {
    const base = {
        timestamp: new Date().toISOString(),
        scope
    };

    if (meta === undefined) {
        return base;
    }

    if (isRecord(meta)) {
        return {
            ...base,
            ...meta
        };
    }

    return {
        ...base,
        value: meta
    };
}

function mergeMeta(primary: unknown, secondary: unknown): unknown {
    if (secondary === undefined) {
        return primary;
    }

    const normalizedPrimary = isRecord(primary) ? primary : { value: primary };

    if (isRecord(secondary)) {
        return {
            ...normalizedPrimary,
            ...secondary
        };
    }

    return {
        ...normalizedPrimary,
        extra: secondary
    };
}

function write(level: Exclude<LogLevel, 'silent'>, message: string, args: unknown[]): void {
    if (!shouldLog(level)) {
        return;
    }

    const sink = console[level] || console.log;
    sink.call(console, message, ...args);
}

function writeWithContext(
    level: Exclude<LogLevel, 'silent'>,
    scope: string,
    message: string,
    meta: unknown
): void {
    write(level, message, [buildContext(scope, meta)]);
}

export function createLogger(scope: string): Logger {
    return {
        debug(message, meta) {
            writeWithContext('debug', scope, message, meta);
        },
        info(message, meta) {
            writeWithContext('info', scope, message, meta);
        },
        warn(message, errOrMeta, meta) {
            if (errOrMeta instanceof Error) {
                write('warn', message, [errOrMeta, buildContext(scope, meta)]);
                return;
            }

            writeWithContext('warn', scope, message, mergeMeta(errOrMeta, meta));
        },
        error(message, errOrMeta, meta) {
            if (errOrMeta instanceof Error) {
                write('error', message, [errOrMeta, buildContext(scope, meta)]);
                return;
            }

            writeWithContext('error', scope, message, mergeMeta(errOrMeta, meta));
        }
    };
}
