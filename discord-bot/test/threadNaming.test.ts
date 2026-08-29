import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { generateThreadName } from '../src/threadNaming.ts';

describe('threadNaming', () => {
    describe('generateThreadName', () => {
        test('should slice prompt within maxLength', () => {
            const name = generateThreadName('これはテスト用のプロンプトです', 'testuser');
            assert.equal(name, 'これはテスト用のプロンプトです');
        });

        test('should append ellipsis when prompt exceeds maxLength', () => {
            const prompt = 'あ'.repeat(50);
            const name = generateThreadName(prompt, 'testuser');
            assert.equal(name, `${'あ'.repeat(30)}…`);
            assert.ok(name.length <= 100, 'Discord thread name limit is 100 chars');
        });

        test('should normalize whitespace and trim', () => {
            const name = generateThreadName('  こんにちは   世界  ', 'testuser');
            assert.equal(name, 'こんにちは 世界');
        });

        test('should not split surrogate pairs (emoji)', () => {
            const prompt = '😀'.repeat(20);
            const name = generateThreadName(prompt, 'testuser');
            // 末尾が孤立したサロゲート（ペアの途中）で終わっていないことを確認
            const base = name.replace(/…$/, '');
            const lastCode = base.charCodeAt(base.length - 1);
            const isLoneSurrogate =
                (lastCode >= 0xd800 && lastCode <= 0xdbff) ||
                (base.length >= 2 &&
                    lastCode >= 0xdc00 &&
                    lastCode <= 0xdfff &&
                    !(
                        base.charCodeAt(base.length - 2) >= 0xd800 &&
                        base.charCodeAt(base.length - 2) <= 0xdbff
                    ));
            assert.ok(
                !isLoneSurrogate,
                `name should not end with lone surrogate: ${JSON.stringify(name)}`
            );
            assert.ok(name.startsWith('😀'));
        });

        test('should return fallback name for empty prompt', () => {
            assert.equal(generateThreadName('', 'testuser'), 'o-testuser');
            assert.equal(generateThreadName('   ', 'testuser'), 'o-testuser');
            assert.equal(generateThreadName(null, 'testuser'), 'o-testuser');
        });

        test('should respect custom maxLength option', () => {
            const name = generateThreadName('あ'.repeat(20), 'testuser', { maxLength: 10 });
            assert.equal(name, `${'あ'.repeat(10)}…`);
        });

        test('should not append ellipsis when exactly maxLength', () => {
            const name = generateThreadName('あ'.repeat(30), 'testuser');
            assert.equal(name, 'あ'.repeat(30));
        });
    });
});
