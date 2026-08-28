import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
    ATTACHMENT_MAX_BYTES,
    ATTACHMENT_MAX_CHARS,
    isTextAttachment,
    loadAttachmentText
} from '../src/attachmentLoader.js';

function createAttachment(overrides = {}) {
    return {
        name: 'sample.txt',
        contentType: 'text/plain',
        size: 10,
        url: 'https://cdn.discordapp.com/attachments/123/456/sample.txt',
        ...overrides
    };
}

describe('attachmentLoader', () => {
    describe('isTextAttachment', () => {
        test('allows text MIME types, allowlisted MIME types, and known extensions', () => {
            assert.equal(isTextAttachment(createAttachment()), true);
            assert.equal(
                isTextAttachment(createAttachment({ contentType: 'application/json' })),
                true
            );
            assert.equal(
                isTextAttachment(createAttachment({ name: 'notes.md', contentType: null })),
                true
            );
        });

        test('rejects image, video, and unknown binary MIME types', () => {
            assert.equal(isTextAttachment(createAttachment({ contentType: 'image/png' })), false);
            assert.equal(isTextAttachment(createAttachment({ contentType: 'video/mp4' })), false);
            assert.equal(
                isTextAttachment(
                    createAttachment({ name: 'source.js', contentType: 'application/octet-stream' })
                ),
                false
            );
        });
    });

    describe('loadAttachmentText', () => {
        test('downloads a validated text attachment', async () => {
            let requestedUrl = null;
            const result = await loadAttachmentText(createAttachment(), {
                fetchImpl: async url => {
                    requestedUrl = url;
                    return new Response('const answer = 42;', {
                        headers: { 'content-type': 'text/plain; charset=utf-8' }
                    });
                }
            });

            assert.equal(requestedUrl, createAttachment().url);
            assert.deepEqual(result, {
                ok: true,
                name: 'sample.txt',
                text: 'const answer = 42;',
                truncated: false
            });
        });

        test('rejects media attachments without downloading them', async () => {
            let fetchCalled = false;
            const result = await loadAttachmentText(
                createAttachment({ contentType: 'image/png' }),
                {
                    fetchImpl: async () => {
                        fetchCalled = true;
                    }
                }
            );

            assert.equal(result.ok, false);
            assert.equal(result.reason, 'image');
            assert.equal(fetchCalled, false);
        });

        test('rejects files above the size limit without downloading them', async () => {
            let fetchCalled = false;
            const result = await loadAttachmentText(
                createAttachment({ size: ATTACHMENT_MAX_BYTES + 1 }),
                {
                    fetchImpl: async () => {
                        fetchCalled = true;
                    }
                }
            );

            assert.equal(result.ok, false);
            assert.equal(result.reason, 'too_large');
            assert.equal(fetchCalled, false);
        });

        test('rejects URLs outside the Discord CDN without downloading them', async () => {
            let fetchCalled = false;
            const result = await loadAttachmentText(
                createAttachment({ url: 'https://example.com/attachment.txt' }),
                {
                    fetchImpl: async () => {
                        fetchCalled = true;
                    }
                }
            );

            assert.equal(result.ok, false);
            assert.equal(result.reason, 'invalid_url');
            assert.equal(fetchCalled, false);
        });

        test('allows ephemeral attachment URLs returned for interactions', async () => {
            const result = await loadAttachmentText(
                createAttachment({
                    url: 'https://cdn.discordapp.com/ephemeral-attachments/123/456/sample.txt'
                }),
                {
                    fetchImpl: async () =>
                        new Response('ephemeral attachment', {
                            headers: { 'content-type': 'text/plain' }
                        })
                }
            );

            assert.deepEqual(result, {
                ok: true,
                name: 'sample.txt',
                text: 'ephemeral attachment',
                truncated: false
            });
        });

        test('revalidates the MIME type returned by the CDN', async () => {
            const result = await loadAttachmentText(createAttachment(), {
                fetchImpl: async () =>
                    new Response('not actually text', {
                        headers: { 'content-type': 'image/png' }
                    })
            });

            assert.equal(result.ok, false);
            assert.equal(result.reason, 'image');
        });

        test('reports download failures without exposing the underlying error', async () => {
            const result = await loadAttachmentText(createAttachment(), {
                fetchImpl: async () => {
                    throw new Error('network unavailable');
                }
            });

            assert.deepEqual(result, {
                ok: false,
                reason: 'fetch_error',
                message: '添付ファイルのダウンロードに失敗しました。'
            });
        });

        test('limits downloaded text to the configured character limit', async () => {
            const result = await loadAttachmentText(createAttachment(), {
                fetchImpl: async () =>
                    new Response('a'.repeat(ATTACHMENT_MAX_CHARS + 100), {
                        headers: { 'content-type': 'text/plain' }
                    })
            });

            assert.equal(result.ok, true);
            assert.equal(result.truncated, true);
            assert.equal(result.text.length, ATTACHMENT_MAX_CHARS);
            assert.match(result.text, /…\(省略\)$/);
        });

        test('rejects bodies that exceed the actual download size limit', async () => {
            const result = await loadAttachmentText(createAttachment(), {
                fetchImpl: async () =>
                    new Response(new Uint8Array(ATTACHMENT_MAX_BYTES + 1), {
                        headers: { 'content-type': 'text/plain' }
                    })
            });

            assert.equal(result.ok, false);
            assert.equal(result.reason, 'too_large');
        });

        test('rejects content with too many UTF-8 replacement characters', async () => {
            const result = await loadAttachmentText(createAttachment(), {
                fetchImpl: async () =>
                    new Response(new Uint8Array(100).fill(0xff), {
                        headers: { 'content-type': 'text/plain' }
                    })
            });

            assert.equal(result.ok, false);
            assert.equal(result.reason, 'unreadable');
        });
    });
});
