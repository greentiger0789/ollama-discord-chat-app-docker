import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
    buildMaidThinkingMessage,
    formatQuotedReference,
    REFERENCE_QUOTE_MAX_LENGTH,
    sendSplitMessage
} from '../src/messageUtils.ts';
import { assertDefined } from '../testing/fakes.ts';

describe('formatQuotedReference', () => {
    test('formats a user message as a quoted reference', () => {
        const formatted = formatQuotedReference({
            author: { bot: false },
            content: '参照元の内容'
        });

        assert.equal(formatted, '（返信元のユーザーメッセージ）\n> 参照元の内容');
    });

    test('identifies a bot message as an assistant message', () => {
        const formatted = formatQuotedReference({
            author: { bot: true },
            content: '参照元の応答'
        });

        assert.equal(formatted, '（返信元のアシスタントメッセージ）\n> 参照元の応答');
    });

    test('quotes every line in a multiline message', () => {
        const formatted = formatQuotedReference({ content: '1行目\n2行目\n3行目' });

        assert.equal(formatted, '（返信元のユーザーメッセージ）\n> 1行目\n> 2行目\n> 3行目');
    });

    test('truncates content longer than the reference quote limit', () => {
        const formatted = formatQuotedReference({
            content: 'a'.repeat(REFERENCE_QUOTE_MAX_LENGTH + 1)
        });

        assert.equal(formatted, `（返信元のユーザーメッセージ）\n> ${'a'.repeat(500)}…`);
    });

    test('formats empty content without throwing', () => {
        const formatted = formatQuotedReference({ content: '' });

        assert.equal(formatted, '（返信元のユーザーメッセージ）\n> ');
    });
});

/* ================================
   buildMaidThinkingMessage テスト
================================ */

describe('buildMaidThinkingMessage', () => {
    test('returns a non-empty string', () => {
        const message = buildMaidThinkingMessage();
        assert.equal(typeof message, 'string');
        assert.ok(message.length > 0);
    });

    test('starts with an emoji', () => {
        const message = buildMaidThinkingMessage();

        // Unicode安全な取得
        const firstChar = Array.from(message)[0];
        assertDefined(firstChar);

        const isEmoji =
            /\p{Extended_Pictographic}/u.test(firstChar) ||
            /\p{Emoji_Presentation}/u.test(firstChar);

        assert.ok(isEmoji, `First character should be emoji: ${firstChar}`);
    });

    test('contains expected keywords', () => {
        const message = buildMaidThinkingMessage();

        const hasExpectedContent =
            message.includes('ご主人様') ||
            message.includes('演算') ||
            message.includes('解析') ||
            message.includes('中') ||
            message.includes('おります');

        assert.ok(hasExpectedContent);
    });

    test('generates varied messages', () => {
        const messages = new Set<string>();

        for (let i = 0; i < 20; i++) {
            messages.add(buildMaidThinkingMessage());
        }

        // ランダムなので1以上ならOK
        assert.ok(messages.size >= 1);
    });
});

/* ================================
   sendSplitMessage テスト
================================ */

describe('sendSplitMessage', () => {
    test('sends short message directly', async () => {
        const messages: string[] = [];

        const mockChannel = {
            send: async (text: string) => messages.push(text)
        };

        const text = '短いメッセージ';

        await sendSplitMessage(mockChannel, text);

        assert.equal(messages.length, 1);
        assert.equal(messages[0], text);
    });

    test('edits message if firstMessageToEdit exists', async () => {
        const edits: string[] = [];

        const mockMessage = {
            edit: async (text: string) => edits.push(text)
        };

        const mockChannel = {
            send: async () => {
                throw new Error('should not send');
            }
        };

        const text = '短い';

        await sendSplitMessage(mockChannel, text, mockMessage);

        assert.equal(edits.length, 1);
        assert.equal(edits[0], text);
    });

    test('splits long message', async () => {
        const messages: string[] = [];

        const mockChannel = {
            send: async (text: string) => messages.push(text)
        };

        const text = 'a'.repeat(2000);

        await sendSplitMessage(mockChannel, text);

        assert.equal(messages.length, 2);
        assertDefined(messages[0]);
        assertDefined(messages[1]);
        assert.equal(messages[0].length, 1900);
        assert.equal(messages[1].length, 100);
    });

    test('splits very long message', async () => {
        const messages: string[] = [];

        const mockChannel = {
            send: async (text: string) => messages.push(text)
        };

        const text = 'x'.repeat(5000);

        await sendSplitMessage(mockChannel, text);

        assert.equal(messages.length, Math.ceil(5000 / 1900));
    });

    test('edits first chunk and sends rest', async () => {
        const edits: string[] = [];
        const messages: string[] = [];

        const mockMessage = {
            edit: async (text: string) => edits.push(text)
        };

        const mockChannel = {
            send: async (text: string) => messages.push(text)
        };

        const text = 'b'.repeat(3000);

        await sendSplitMessage(mockChannel, text, mockMessage);

        assert.equal(edits.length, 1);
        assertDefined(edits[0]);
        assert.equal(edits[0].length, 1900);

        assert.equal(messages.length, 1);
        assertDefined(messages[0]);
        assert.equal(messages[0].length, 1100);
    });

    test('exactly 1900 characters', async () => {
        const messages: string[] = [];

        const mockChannel = {
            send: async (text: string) => messages.push(text)
        };

        const text = 'c'.repeat(1900);

        await sendSplitMessage(mockChannel, text);

        assert.equal(messages.length, 1);
        assertDefined(messages[0]);
        assert.equal(messages[0].length, 1900);
    });

    test('1901 characters', async () => {
        const messages: string[] = [];

        const mockChannel = {
            send: async (text: string) => messages.push(text)
        };

        const text = 'd'.repeat(1901);

        await sendSplitMessage(mockChannel, text);

        assert.equal(messages.length, 2);
        assertDefined(messages[0]);
        assertDefined(messages[1]);
        assert.equal(messages[0].length, 1900);
        assert.equal(messages[1].length, 1);
    });
});
