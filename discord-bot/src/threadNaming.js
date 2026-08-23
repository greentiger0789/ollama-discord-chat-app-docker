// スレッド名自動生成ロジック
// LLM を使わずプロンプト先頭から切り出すことで、スレッド作成時の遅延とコストを回避する

const DEFAULT_MAX_LENGTH = 30;

export function generateThreadName(prompt, username, { maxLength = DEFAULT_MAX_LENGTH } = {}) {
    const cleaned = String(prompt || '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned) {
        return `o-${username}`;
    }

    let name = cleaned.slice(0, maxLength);

    // サロゲートペア（絵文字など）の途中（高位サロゲート単体）で切断された場合のみ調整
    const lastCode = name.charCodeAt(name.length - 1);
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
        name = name.slice(0, -1);
    }

    return `${name}${cleaned.length > maxLength ? '…' : ''}`;
}
