import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
    executeSearchWithDeps,
    parseResponseBody,
    requestJson,
    searchDuckDuckGoWithDeps,
    searchTavilyWithDeps
} from '../src/ollamaClient.js';

describe('ollamaClient HTTP helpers', () => {
    test('parseResponseBody should return null for empty responses', async () => {
        const data = await parseResponseBody({
            text: async () => ''
        });

        assert.equal(data, null);
    });

    test('requestJson should return plain text for non-JSON responses', async () => {
        const result = await requestJson({
            url: 'https://example.test/plain-text',
            method: 'GET',
            timeout: 100,
            fetchImpl: async () => ({
                ok: true,
                text: async () => 'plain text response'
            })
        });

        assert.equal(result.data, 'plain text response');
    });

    test('requestJson should attach parsed error responses', async () => {
        await assert.rejects(
            requestJson({
                url: 'https://example.test/server-error',
                method: 'GET',
                timeout: 100,
                fetchImpl: async () => ({
                    ok: false,
                    status: 500,
                    text: async () => JSON.stringify({ error: 'server failed' })
                })
            }),
            err => {
                assert.equal(err.response.status, 500);
                assert.deepEqual(err.response.data, { error: 'server failed' });
                return true;
            }
        );
    });

    test('requestJson should convert AbortError into a timeout error', async () => {
        await assert.rejects(
            requestJson({
                url: 'https://example.test/timeout',
                method: 'GET',
                timeout: 10,
                fetchImpl: async (_url, { signal }) => {
                    return await new Promise((_resolve, reject) => {
                        signal.addEventListener(
                            'abort',
                            () => {
                                const err = new Error('aborted');
                                err.name = 'AbortError';
                                reject(err);
                            },
                            { once: true }
                        );
                    });
                }
            }),
            err => {
                assert.match(err.message, /Request timed out after 10ms/);
                assert.equal(err.cause?.name, 'AbortError');
                return true;
            }
        );
    });
});

describe('ollamaClient search formatting', () => {
    test('searchTavilyWithDeps should handle a missing Tavily client gracefully', async () => {
        const result = await searchTavilyWithDeps('missing client', null);

        assert.equal(result, 'Tavily検索に失敗しました。');
    });

    test('searchDuckDuckGoWithDeps should flatten nested RelatedTopics', async () => {
        const result = await searchDuckDuckGoWithDeps('nested topic', {
            get: async () => ({
                data: {
                    RelatedTopics: [
                        {
                            Topics: [
                                { Text: 'first nested result' },
                                { Text: 'second nested result' }
                            ]
                        },
                        { Text: 'top level result' }
                    ]
                }
            })
        });

        assert.equal(result, 'first nested result\nsecond nested result\ntop level result');
    });

    test('searchDuckDuckGoWithDeps should handle empty RelatedTopics', async () => {
        const result = await searchDuckDuckGoWithDeps('empty query', {
            get: async () => ({
                data: {
                    RelatedTopics: []
                }
            })
        });

        assert.equal(result, '検索結果が見つかりませんでした。');
    });

    test('searchDuckDuckGoWithDeps should handle missing Text fields', async () => {
        const result = await searchDuckDuckGoWithDeps('no text query', {
            get: async () => ({
                data: {
                    RelatedTopics: [
                        { Text: 'valid result' },
                        { Text: '' },
                        { Title: 'no text field' },
                        {}
                    ]
                }
            })
        });

        assert.equal(result, 'valid result');
    });

    test('searchDuckDuckGoWithDeps should limit results to 5 items', async () => {
        const result = await searchDuckDuckGoWithDeps('many results', {
            get: async () => ({
                data: {
                    RelatedTopics: Array.from({ length: 10 }, (_, i) => ({
                        Text: `result ${i + 1}`
                    }))
                }
            })
        });

        const lines = result.split('\n');
        assert.equal(lines.length, 5);
        assert.equal(lines[0], 'result 1');
        assert.equal(lines[4], 'result 5');
    });

    test('searchDuckDuckGoWithDeps should handle HTTP errors gracefully', async () => {
        const result = await searchDuckDuckGoWithDeps('error query', {
            get: async () => {
                throw new Error('Network error');
            }
        });

        assert.equal(result, 'DuckDuckGo検索に失敗しました。');
    });

    test('searchDuckDuckGoWithDeps should handle missing RelatedTopics key', async () => {
        const result = await searchDuckDuckGoWithDeps('missing key query', {
            get: async () => ({
                data: {}
            })
        });

        assert.equal(result, '検索結果が見つかりませんでした。');
    });

    test('searchDuckDuckGoWithDeps should return string type result', async () => {
        const result = await searchDuckDuckGoWithDeps('type check', {
            get: async () => ({
                data: {
                    RelatedTopics: [{ Text: 'test result' }]
                }
            })
        });

        assert.equal(typeof result, 'string');
        assert.ok(result.length > 0);
    });

    test('searchTavilyWithDeps should truncate long result bodies', async () => {
        const result = await searchTavilyWithDeps('truncate me', {
            search: async () => ({
                results: [
                    {
                        title: 'Long Result',
                        content: 'a'.repeat(700),
                        url: 'https://example.test/result'
                    }
                ]
            })
        });

        assert.ok(result.includes('タイトル: Long Result'));
        assert.ok(result.includes('URL: https://example.test/result'));
        assert.ok(result.includes(`${'a'.repeat(500)}...`));
        assert.ok(!result.includes('a'.repeat(600)));
    });
});

describe('ollamaClient search fallback', () => {
    test('executeSearchWithDeps should keep Tavily error when Tavily client is missing', async () => {
        let ddgCalled = false;

        const result = await executeSearchWithDeps(
            { engine: 'tavily', searchQuery: 'fallback query' },
            null,
            {
                get: async () => {
                    ddgCalled = true;
                    return {
                        data: {
                            RelatedTopics: [{ Text: 'DuckDuckGo fallback result' }]
                        }
                    };
                }
            }
        );

        assert.equal(result, 'Tavily検索に失敗しました。');
        assert.equal(ddgCalled, false);
    });

    test('executeSearchWithDeps should fall back to DuckDuckGo when Tavily search throws', async () => {
        let ddgCalled = false;

        const result = await executeSearchWithDeps(
            { engine: 'tavily', searchQuery: 'fallback query' },
            {
                search: async () => {
                    throw new Error('Tavily outage');
                }
            },
            {
                get: async () => {
                    ddgCalled = true;
                    return {
                        data: {
                            RelatedTopics: [{ Text: 'DuckDuckGo recovered result' }]
                        }
                    };
                }
            }
        );

        assert.equal(result, 'DuckDuckGo recovered result');
        assert.equal(ddgCalled, true);
    });

    test('executeSearchWithDeps should keep Tavily results when Tavily succeeds', async () => {
        let ddgCalled = false;

        const result = await executeSearchWithDeps(
            { engine: 'tavily', searchQuery: 'primary query' },
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
                get: async () => {
                    ddgCalled = true;
                    return {
                        data: {
                            RelatedTopics: [{ Text: 'DuckDuckGo should not run' }]
                        }
                    };
                }
            }
        );

        assert.ok(result.includes('タイトル: Tavily Result'));
        assert.equal(ddgCalled, false);
    });

    test('executeSearchWithDeps should not fall back when Tavily returns no results', async () => {
        let ddgCalled = false;

        const result = await executeSearchWithDeps(
            { engine: 'tavily', searchQuery: 'no result query' },
            {
                search: async () => ({
                    results: []
                })
            },
            {
                get: async () => {
                    ddgCalled = true;
                    return {
                        data: {
                            RelatedTopics: [{ Text: 'DuckDuckGo fallback result' }]
                        }
                    };
                }
            }
        );

        assert.equal(result, '検索結果が見つかりませんでした。');
        assert.equal(ddgCalled, false);
    });

    test('executeSearchWithDeps should keep Tavily error when DuckDuckGo returns no results', async () => {
        const result = await executeSearchWithDeps(
            { engine: 'tavily', searchQuery: 'broken query' },
            {
                search: async () => {
                    throw new Error('Tavily outage');
                }
            },
            {
                get: async () => ({
                    data: {
                        RelatedTopics: []
                    }
                })
            }
        );

        assert.equal(result, 'Tavily検索に失敗しました。');
    });

    test('executeSearchWithDeps should return the original Tavily error when both engines fail', async () => {
        const result = await executeSearchWithDeps(
            { engine: 'tavily', searchQuery: 'broken query' },
            {
                search: async () => {
                    throw new Error('Tavily outage');
                }
            },
            {
                get: async () => {
                    throw new Error('DuckDuckGo outage');
                }
            }
        );

        assert.equal(result, 'Tavily検索に失敗しました。');
    });
});
