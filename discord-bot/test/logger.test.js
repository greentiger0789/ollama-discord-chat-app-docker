import assert from 'node:assert/strict';
import test, { afterEach, describe } from 'node:test';
import { createLogger } from '../src/logger.js';

const originalLogLevel = process.env.LOG_LEVEL;
const originalConsoleInfo = console.info;
const originalConsoleError = console.error;

afterEach(() => {
    if (originalLogLevel === undefined) {
        delete process.env.LOG_LEVEL;
    } else {
        process.env.LOG_LEVEL = originalLogLevel;
    }

    console.info = originalConsoleInfo;
    console.error = originalConsoleError;
});

describe('logger', () => {
    test('should suppress logs when LOG_LEVEL is silent', () => {
        process.env.LOG_LEVEL = 'silent';
        const logger = createLogger('testLogger');
        const infoCalls = [];
        const errorCalls = [];

        console.info = (...args) => {
            infoCalls.push(args);
        };
        console.error = (...args) => {
            errorCalls.push(args);
        };

        logger.info('info message', { value: 1 });
        logger.error('error message', { value: 2 });

        assert.equal(infoCalls.length, 0);
        assert.equal(errorCalls.length, 0);
    });

    test('should emit info logs with scope and metadata', () => {
        process.env.LOG_LEVEL = 'info';
        const logger = createLogger('testLogger');
        const infoCalls = [];

        console.info = (...args) => {
            infoCalls.push(args);
        };

        logger.info('info message', { requestId: 'req-1' });

        assert.equal(infoCalls.length, 1);
        assert.equal(infoCalls[0][0], 'info message');
        assert.equal(infoCalls[0][1]?.scope, 'testLogger');
        assert.equal(infoCalls[0][1]?.requestId, 'req-1');
        assert.match(String(infoCalls[0][1]?.timestamp), /^\d{4}-\d{2}-\d{2}T/);
    });

    test('should emit error logs and keep Error plus metadata', () => {
        process.env.LOG_LEVEL = 'error';
        const logger = createLogger('testLogger');
        const errorCalls = [];
        const err = new Error('boom');

        console.error = (...args) => {
            errorCalls.push(args);
        };

        logger.info('suppressed info');
        logger.error('error message', err, { requestId: 'req-2' });

        assert.equal(errorCalls.length, 1);
        assert.equal(errorCalls[0][0], 'error message');
        assert.equal(errorCalls[0][1], err);
        assert.equal(errorCalls[0][2]?.scope, 'testLogger');
        assert.equal(errorCalls[0][2]?.requestId, 'req-2');
        assert.match(String(errorCalls[0][2]?.timestamp), /^\d{4}-\d{2}-\d{2}T/);
    });
});
