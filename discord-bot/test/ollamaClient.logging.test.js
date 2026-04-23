import assert from 'node:assert/strict';
import test, { afterEach, describe } from 'node:test';
import { executeSearchWithDeps } from '../src/ollamaClient.js';

const originalLogLevel = process.env.LOG_LEVEL;
const originalConsoleInfo = console.info;

afterEach(() => {
    if (originalLogLevel === undefined) {
        delete process.env.LOG_LEVEL;
    } else {
        process.env.LOG_LEVEL = originalLogLevel;
    }

    console.info = originalConsoleInfo;
});

function captureInfoLogs() {
    process.env.LOG_LEVEL = 'info';
    const logs = [];
    console.info = (...args) => {
        logs.push(args);
    };
    return logs;
}

describe('ollamaClient logging', () => {
    test('should log when Tavily is selected and called', async () => {
        const logs = captureInfoLogs();

        await executeSearchWithDeps(
            { engine: 'tavily', searchQuery: 'latest topic' },
            {
                search: async () => ({
                    results: [
                        {
                            title: 'Tavily Result',
                            content: 'Primary content',
                            url: 'https://example.test/tavily'
                        }
                    ]
                })
            },
            {
                get: async () => ({
                    data: {
                        RelatedTopics: []
                    }
                })
            }
        );

        const messages = logs.map(([message]) => message);
        assert.ok(messages.includes('Using Tavily for web search'));
        assert.ok(messages.includes('Calling Tavily search'));

        const selectionLog = logs.find(([message]) => message === 'Using Tavily for web search');
        assert.equal(selectionLog[1]?.scope, 'ollamaClient');
        assert.equal(selectionLog[1]?.query, 'latest topic');
    });

    test('should log when DuckDuckGo is selected and called', async () => {
        const logs = captureInfoLogs();

        await executeSearchWithDeps({ engine: 'ddg', searchQuery: 'general topic' }, null, {
            get: async () => ({
                data: {
                    RelatedTopics: [{ Text: 'DuckDuckGo result' }]
                }
            })
        });

        const messages = logs.map(([message]) => message);
        assert.ok(messages.includes('Using DuckDuckGo for web search'));
        assert.ok(messages.includes('Calling DuckDuckGo search'));

        const callLog = logs.find(([message]) => message === 'Calling DuckDuckGo search');
        assert.equal(callLog[1]?.scope, 'ollamaClient');
        assert.equal(callLog[1]?.query, 'general topic');
    });
});
