import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';

import { handleThreadMessage } from '../src/handlers/threadMessageHandler.js';

function createMessage({ content = '返信内容', reference } = {}) {
    return {
        channel: {
            isThread: () => true,
            id: 'thread-reference',
            send: async () => ({ edit: async () => {} })
        },
        author: { bot: false },
        content,
        reference
    };
}

function createDeps(overrides = {}) {
    return {
        buildMaidThinkingMessage: () => '考え中...',
        sendSplitMessage: async () => {},
        generateResponse: async () => 'アシスタント応答',
        addToThreadHistory: () => {},
        getThreadHistory: () => [],
        ...overrides
    };
}

describe('threadMessageHandler reply references', () => {
    let originalConsoleWarn;

    before(() => {
        originalConsoleWarn = console.warn;
        console.warn = () => {};
    });

    after(() => {
        console.warn = originalConsoleWarn;
    });

    test('does not resolve a reference when the message is not a reply', async () => {
        let fetchCalled = false;
        let generatedPrompt;
        const addedMessages = [];

        await handleThreadMessage(
            createMessage({ content: '通常の発言' }),
            createDeps({
                fetchReferencedMessage: async () => {
                    fetchCalled = true;
                },
                generateResponse: async prompt => {
                    generatedPrompt = prompt;
                    return 'アシスタント応答';
                },
                addToThreadHistory: (_threadId, entry) => addedMessages.push(entry)
            })
        );

        assert.equal(fetchCalled, false);
        assert.equal(generatedPrompt, '通常の発言');
        assert.deepEqual(addedMessages, [
            { role: 'user', text: '通常の発言' },
            { role: 'assistant', text: 'アシスタント応答' }
        ]);
    });

    test('adds a referenced user message to the prompt and user history entry', async () => {
        let fetchedMessage;
        let generatedPrompt;
        const addedMessages = [];
        const message = createMessage({
            content: 'この部分を詳しく',
            reference: { messageId: 'reference-user' }
        });

        await handleThreadMessage(
            message,
            createDeps({
                fetchReferencedMessage: async receivedMessage => {
                    fetchedMessage = receivedMessage;
                    return { author: { bot: false }, content: '以前の説明' };
                },
                generateResponse: async prompt => {
                    generatedPrompt = prompt;
                    return '詳しい回答';
                },
                addToThreadHistory: (_threadId, entry) => addedMessages.push(entry)
            })
        );

        const expectedPrompt = '（返信元のユーザーメッセージ）\n> 以前の説明\nこの部分を詳しく';
        assert.equal(fetchedMessage, message);
        assert.equal(generatedPrompt, expectedPrompt);
        assert.deepEqual(addedMessages, [
            { role: 'user', text: expectedPrompt },
            { role: 'assistant', text: '詳しい回答' }
        ]);
    });

    test('includes a referenced assistant message', async () => {
        let generatedPrompt;

        await handleThreadMessage(
            createMessage({ reference: { messageId: 'reference-assistant' } }),
            createDeps({
                fetchReferencedMessage: async () => ({
                    author: { bot: true },
                    content: 'メイドちゃんの回答'
                }),
                generateResponse: async prompt => {
                    generatedPrompt = prompt;
                    return '補足回答';
                }
            })
        );

        assert.equal(
            generatedPrompt,
            '（返信元のアシスタントメッセージ）\n> メイドちゃんの回答\n返信内容'
        );
    });

    test('continues without a quote when the referenced message has no content', async () => {
        let generatedPrompt;

        await handleThreadMessage(
            createMessage({
                content: '埋め込みについて',
                reference: { messageId: 'reference-embed' }
            }),
            createDeps({
                fetchReferencedMessage: async () => ({ content: '' }),
                generateResponse: async prompt => {
                    generatedPrompt = prompt;
                    return '回答';
                }
            })
        );

        assert.equal(generatedPrompt, '埋め込みについて');
    });

    test('continues when resolving a deleted referenced message fails and logs a warning', async () => {
        const originalLogLevel = process.env.LOG_LEVEL;
        const warningLogs = [];
        console.warn = (...args) => warningLogs.push(args);
        process.env.LOG_LEVEL = 'warn';
        let generatedPrompt;

        try {
            await handleThreadMessage(
                createMessage({
                    content: '削除済みの内容について',
                    reference: { messageId: 'deleted-message' }
                }),
                createDeps({
                    fetchReferencedMessage: async () => {
                        throw new Error('Unknown Message');
                    },
                    generateResponse: async prompt => {
                        generatedPrompt = prompt;
                        return '回答';
                    }
                })
            );
        } finally {
            console.warn = () => {};
            if (originalLogLevel === undefined) {
                delete process.env.LOG_LEVEL;
            } else {
                process.env.LOG_LEVEL = originalLogLevel;
            }
        }

        assert.equal(generatedPrompt, '削除済みの内容について');
        const warning = warningLogs.find(
            ([message]) => message === 'Failed to resolve referenced message'
        );
        assert.ok(warning);
        assert.equal(warning[1].message, 'Unknown Message');
        assert.equal(warning[2].threadId, 'thread-reference');
        assert.equal(warning[2].referenceId, 'deleted-message');
    });
});
