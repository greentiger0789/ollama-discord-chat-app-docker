import assert from 'node:assert/strict';
import test from 'node:test';
import createOllamaClient, { isResponseAbortedError, requestJson } from '../src/ollamaClient.ts';

test('requestJson distinguishes user cancellation from a timeout', async () => {
    const controller = new AbortController();
    const request = requestJson({
        url: 'https://example.test/abort',
        method: 'GET',
        timeout: 100,
        signal: controller.signal,
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
    });

    controller.abort();
    await assert.rejects(request, isResponseAbortedError);
});

test('generate propagates the abort signal through all Ollama chat requests', async () => {
    const signal = new AbortController().signal;
    const receivedSignals: Array<AbortSignal | undefined> = [];
    let requestCount = 0;
    const client = createOllamaClient({
        searchFn: async () => '',
        httpClient: {
            post: async (_resource, _data, options) => {
                receivedSignals.push(options?.signal);
                requestCount++;
                if (requestCount === 1) {
                    return {
                        data: {
                            message: { content: JSON.stringify({ needSearch: false }) }
                        }
                    };
                }
                return { data: { message: { content: '回答' } } };
            }
        }
    });

    const response = await client.generate({ prompt: 'テスト', history: [], signal });

    assert.equal(response, '回答');
    assert.deepEqual(receivedSignals, [signal, signal]);
});
