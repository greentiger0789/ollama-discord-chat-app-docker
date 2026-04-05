import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
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
