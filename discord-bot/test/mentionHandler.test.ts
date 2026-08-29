import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';
import {
    EMPTY_MENTION_RESPONSE,
    extractMentionPrompt,
    handleMentionMessage
} from '../src/handlers/mentionHandler.ts';
import type { HistoryEntry } from '../src/threadManager.ts';
import { assertDefined, createDeferred } from '../testing/fakes.ts';

const CLIENT_ID = '123456789012345678';
type MentionMessage = Parameters<typeof handleMentionMessage>[0];
type MentionDeps = NonNullable<Parameters<typeof handleMentionMessage>[1]>;

function createMessage({
    content = `<@${CLIENT_ID}> テストです`,
    channelId = 'channel-123',
    isThread = false,
    isBot = false,
    mentioned = true
}: {
    content?: string;
    channelId?: string;
    isThread?: boolean;
    isBot?: boolean;
    mentioned?: boolean;
} = {}): MentionMessage {
    return {
        content,
        channel: {
            id: channelId,
            isThread: () => isThread,
            send: async () => ({ edit: async () => {} })
        },
        author: { id: 'user-123', bot: isBot },
        mentions: { users: { has: (id: string) => mentioned && id === CLIENT_ID } }
    };
}

function createDeps(overrides: MentionDeps = {}): MentionDeps {
    return {
        clientId: CLIENT_ID,
        buildMaidThinkingMessage: () => '考え中です…',
        sendSplitMessage: async () => {},
        generateResponse: async () => '応答です',
        addToThreadHistory: () => {},
        getThreadHistory: () => [],
        ...overrides
    };
}

describe('mentionHandler', () => {
    let originalConsoleError: typeof console.error;

    before(() => {
        originalConsoleError = console.error;
        console.error = () => {};
    });

    after(() => {
        console.error = originalConsoleError;
    });

    describe('extractMentionPrompt', () => {
        test('removes standard and nickname bot mentions', () => {
            assert.equal(
                extractMentionPrompt(`<@${CLIENT_ID}> 今日の天気は？`, CLIENT_ID),
                '今日の天気は？'
            );
            assert.equal(extractMentionPrompt(`<@!${CLIENT_ID}> おはよう`, CLIENT_ID), 'おはよう');
        });

        test('removes only this bot mentions and trims whitespace', () => {
            assert.equal(
                extractMentionPrompt(` \n<@${CLIENT_ID}> <@999> こんにちは\n `, CLIENT_ID),
                '<@999> こんにちは'
            );
        });

        test('returns an empty string for an empty prompt or missing content', () => {
            assert.equal(extractMentionPrompt(`<@${CLIENT_ID}>`, CLIENT_ID), '');
            assert.equal(extractMentionPrompt(null, CLIENT_ID), '');
            assert.equal(extractMentionPrompt(undefined, CLIENT_ID), '');
        });
    });

    test('exports an async mention handler', () => {
        assert.equal(typeof handleMentionMessage, 'function');
        assert.equal(handleMentionMessage.constructor.name, 'AsyncFunction');
    });

    const ignoredCases = [
        ['thread messages', { isThread: true }],
        ['bot messages', { isBot: true }],
        ['messages without a bot mention', { mentioned: false, content: 'こんにちは' }]
    ] satisfies ReadonlyArray<
        readonly [
            string,
            {
                content?: string;
                isThread?: boolean;
                isBot?: boolean;
                mentioned?: boolean;
            }
        ]
    >;

    for (const [name, messageOptions] of ignoredCases) {
        test(`ignores ${name}`, async () => {
            let generateCalled = false;
            await handleMentionMessage(
                createMessage(messageOptions),
                createDeps({
                    generateResponse: async () => {
                        generateCalled = true;
                        return 'ignored';
                    }
                })
            );
            assert.equal(generateCalled, false);
        });
    }

    test('uses the channel history and records the mention response pair', async () => {
        const calls: {
            added: Array<{ id: string; entry: HistoryEntry }>;
            sent: Array<string | object>;
            split: [unknown, string, ...unknown[]] | null;
            generate: { prompt: string; history: readonly HistoryEntry[] } | null;
            historyId: string | null;
        } = { added: [], sent: [], split: null, generate: null, historyId: null };
        const message = createMessage({ content: `<@!${CLIENT_ID}> 調べて` });
        assert.ok(message.channel);
        message.channel.send = async text => {
            calls.sent.push(text);
            return { edit: async () => {} };
        };

        await handleMentionMessage(
            message,
            createDeps({
                getThreadHistory: id => {
                    calls.historyId = id;
                    return [{ role: 'user', text: '以前の質問' }];
                },
                addToThreadHistory: (id, entry) => {
                    calls.added.push({ id, entry });
                },
                generateResponse: async (prompt, history) => {
                    calls.generate = { prompt, history };
                    return '回答です';
                },
                sendSplitMessage: async (...args) => {
                    calls.split = args;
                }
            })
        );

        assert.equal(calls.historyId, 'channel-123');
        assert.deepEqual(calls.generate, {
            prompt: '調べて',
            history: [{ role: 'user', text: '以前の質問' }]
        });
        assert.deepEqual(calls.added, [
            { id: 'channel-123', entry: { role: 'user', text: '調べて' } },
            { id: 'channel-123', entry: { role: 'assistant', text: '回答です' } }
        ]);
        assert.deepEqual(calls.sent, ['考え中です…']);
        assertDefined(calls.split);
        assert.equal(calls.split[0], message.channel);
        assert.equal(calls.split[1], '回答です');
    });

    test('uses a fixed response without calling the LLM for a mention-only message', async () => {
        let generateCalled = false;
        let historyCalled = false;
        let splitText = null;

        await handleMentionMessage(
            createMessage({ content: `<@${CLIENT_ID}>` }),
            createDeps({
                generateResponse: async () => {
                    generateCalled = true;
                    return 'ignored';
                },
                getThreadHistory: () => {
                    historyCalled = true;
                    return [];
                },
                sendSplitMessage: async (_channel, text) => {
                    splitText = text;
                }
            })
        );

        assert.equal(generateCalled, false);
        assert.equal(historyCalled, false);
        assert.equal(splitText, EMPTY_MENTION_RESPONSE);
    });

    test('serializes concurrent mentions in the same channel', async () => {
        const firstStarted = createDeferred();
        const firstRelease = createDeferred();
        const history: HistoryEntry[] = [];
        const generateCalls: Array<{
            prompt: string;
            priorHistory: readonly HistoryEntry[];
        }> = [];
        const deps = createDeps({
            getThreadHistory: () => history.map(entry => ({ ...entry })),
            addToThreadHistory: (_channelId, entry) => {
                history.push(entry);
            },
            generateResponse: async (prompt, priorHistory) => {
                generateCalls.push({ prompt, priorHistory });
                if (prompt === 'first') {
                    firstStarted.resolve();
                    await firstRelease.promise;
                }
                return `${prompt} response`;
            }
        });

        const first = handleMentionMessage(
            createMessage({ content: `<@${CLIENT_ID}> first`, channelId: 'queued-channel' }),
            deps
        );
        await firstStarted.promise;
        const second = handleMentionMessage(
            createMessage({ content: `<@${CLIENT_ID}> second`, channelId: 'queued-channel' }),
            deps
        );

        assert.equal(generateCalls.length, 1);
        firstRelease.resolve();
        await Promise.all([first, second]);

        assert.deepEqual(generateCalls, [
            { prompt: 'first', priorHistory: [] },
            {
                prompt: 'second',
                priorHistory: [
                    { role: 'user', text: 'first' },
                    { role: 'assistant', text: 'first response' }
                ]
            }
        ]);
    });

    test('sends the standard error message when response generation fails', async () => {
        const sent: Array<string | object> = [];
        const message = createMessage();
        assert.ok(message.channel);
        message.channel.send = async text => {
            sent.push(text);
            return { edit: async () => {} };
        };

        await handleMentionMessage(
            message,
            createDeps({ generateResponse: async () => Promise.reject(new Error('failed')) })
        );

        assert.deepEqual(sent, ['考え中です…', 'エラーが発生しました。']);
    });
});
