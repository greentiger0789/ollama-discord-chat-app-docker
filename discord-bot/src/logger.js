const LOG_LEVEL_PRIORITY = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    silent: 50
};

function isTestEnvironment() {
    return (
        process.execArgv.includes('--test') ||
        process.argv.includes('--test') ||
        process.env.NODE_ENV === 'test'
    );
}

function normalizeLogLevel(level) {
    const normalized = String(level || '').toLowerCase();
    return Object.hasOwn(LOG_LEVEL_PRIORITY, normalized) ? normalized : null;
}

function getConfiguredLogLevel() {
    return normalizeLogLevel(process.env.LOG_LEVEL) || (isTestEnvironment() ? 'warn' : 'info');
}

function shouldLog(level) {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[getConfiguredLogLevel()];
}

function buildContext(scope, meta) {
    const base = {
        timestamp: new Date().toISOString(),
        scope
    };

    if (meta === undefined) {
        return base;
    }

    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
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

function mergeMeta(primary, secondary) {
    if (secondary === undefined) {
        return primary;
    }

    const normalizedPrimary =
        primary && typeof primary === 'object' && !Array.isArray(primary)
            ? primary
            : {
                  value: primary
              };

    if (secondary && typeof secondary === 'object' && !Array.isArray(secondary)) {
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

function write(level, message, args) {
    if (!shouldLog(level)) {
        return;
    }

    const sink = console[level] || console.log;
    sink.call(console, message, ...args);
}

function writeWithContext(level, scope, message, meta) {
    write(level, message, [buildContext(scope, meta)]);
}

export function createLogger(scope) {
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
