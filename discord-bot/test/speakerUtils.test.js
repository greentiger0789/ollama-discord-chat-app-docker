import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
    formatEntryForLlm,
    isMultiUserHistory,
    resolveSpeakerName,
    sanitizeSpeakerName
} from '../src/speakerUtils.js';

describe('speakerUtils', () => {
    test('resolves display names in Discord priority order', () => {
        assert.equal(
            resolveSpeakerName({
                member: { displayName: 'サーバー名' },
                author: { globalName: 'グローバル名', username: 'username' }
            }),
            'サーバー名'
        );
        assert.equal(
            resolveSpeakerName({ author: { globalName: 'グローバル名', username: 'username' } }),
            'グローバル名'
        );
        assert.equal(resolveSpeakerName({ author: { username: 'username' } }), 'username');
        assert.equal(resolveSpeakerName({}), 'ユーザー');
    });

    test('supports command interactions and sanitizes resolved names', () => {
        assert.equal(
            resolveSpeakerName({ user: { globalName: 'コマンド利用者' } }),
            'コマンド利用者'
        );
        assert.equal(sanitizeSpeakerName('  Alice\n\r Bob  '), 'Alice Bob');
        assert.equal(sanitizeSpeakerName('【Alice】'), '(Alice)');
        assert.equal(sanitizeSpeakerName('😀'.repeat(33)), '😀'.repeat(32));
    });

    test('detects only histories with two or more user speakers as multi-user', () => {
        assert.equal(
            isMultiUserHistory([
                { role: 'user', text: 'A', speaker: 'Alice' },
                { role: 'assistant', text: '応答' },
                { role: 'user', text: 'B', speaker: 'Bob' }
            ]),
            true
        );
        assert.equal(isMultiUserHistory([{ role: 'user', text: 'A', speaker: 'Alice' }]), false);
        assert.equal(isMultiUserHistory([{ role: 'user', text: 'A' }]), false);
        assert.equal(
            isMultiUserHistory([{ role: 'assistant', text: '応答', speaker: 'Alice' }]),
            false
        );
    });

    test('formats only multi-user user entries with speaker prefixes', () => {
        assert.deepEqual(
            formatEntryForLlm({ role: 'user', text: '質問', speaker: 'Alice' }, true),
            { role: 'user', content: '【Alice】質問' }
        );
        assert.deepEqual(
            formatEntryForLlm({ role: 'user', text: '質問', speaker: 'Alice' }, false),
            { role: 'user', content: '質問' }
        );
        assert.deepEqual(
            formatEntryForLlm({ role: 'assistant', text: '回答', speaker: 'Alice' }, true),
            { role: 'assistant', content: '回答' }
        );
    });
});
