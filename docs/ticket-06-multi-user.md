# チケット6: 複数人での会話対応

## 概要

スレッド内に最初の発言者以外が発言したとき、複数人で会話していることを LLM が考慮した返信ができるようにする。

- 例: ユーザーA が質問し、ユーザーB が追加質問した場合、「ご主人様」の呼びかけや文脈を適切に扱う
- 方針: **全員を「ご主人様」と呼ぶ既存ルールは維持しつつ、発言者名を `【名前】` プレフィックスで区別可能にする**

**工数感: M（実装だけなら S、テスト込みで M）**

## 現状の関連コード

### `discord-bot/src/handlers/threadMessageHandler.js`
- **L36-83**: `processThreadMessage(message, deps)`。依存関係（`buildMaidThinkingMessage` / `sendSplitMessage` / `generateResponse` / `addToThreadHistory` / `getThreadHistory`）を DI で受け取る
- **L43-49**: `message.author?.id` は**ログ出力のみ**に使用。履歴には反映されない
- **L51-54**: 履歴追加は `{ role: 'user', text: message.content }` のみ。**発言者情報は完全に捨てられている**
- **L59**: `generateResponse(message.content, history)` — 直前までの履歴（自分の今回分は未含）を渡す

### `discord-bot/src/threadManager.js`
- **L19-23**: `addToThreadHistory(threadId, message)` — エントリをそのままクローンして保存。**スキーマ検証なし**なので `{ role, text }` 以外のフィールドも透過的に保持可能
- **L26-30**: `initializeThread(threadId, initialMessage)` — `{ role: 'user', text: initialMessage }` を生成
- **L2-17**: `cloneMessage` はシャローコピー（`{ ...message }`）のため、追加フィールドも自然に複製される

### `discord-bot/src/commands/oCommand.js`
- **L47-48**: スレッド作成時に `initializeThread(thread.id)` → `addToThreadHistory(thread.id, { role: 'user', text: prompt })`。ここでも発言者名は記録されない

### `discord-bot/src/ollamaClient.js`
- **L69-77**: `estimateTokensFromText` / `estimateTokensFromHistory` — `m.text` のみを参照（`text.length / 3`）
- **L89-113**: 履歴が閾値超過時、`history.slice(0, -1)` を `summarizeHistory` に渡し、先頭に `{ role: 'assistant', text: '【過去の会話要約】...' }` を挿入
- **L128-142**: `finalMessages` 構築 — `processedHistory.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }))`。**`speaker` 的な概念は存在しない**
- **L666-671**: `generateResponse(prompt, history, model)` エクスポート
- **L672-700**: `summarizeHistory` — `history.map(m => \`${m.role}: ${m.text}\`).join('\n')` で要約用テキストを生成

### `discord-bot/config/prompts.yml` + `src/prompts.js`
- `prompts.system`: 「ユーザーのことは必ず『ご主人様』と呼びます」「絶対ルール: ご主人様を呼び捨てにしません」— **単一ユーザー前提の記述**
- `prompts.js`: `SYSTEM_PROMPT` を静的エクスポート。実行時に差し込む仕組みはない

### 既存テストのパターン
- `test/threadManager.test.js`: クエリパラメータ付き動的 import で毎回 fresh import。`assert.deepEqual` でエントリ全体を比較するため、**フィールド追加すると既存テストの期待値変更が必要になる箇所がある**
- `test/threadMessageHandler.test.js`: モック `message` + DI による deps 注入。「依存関数が呼ばれたか」をフラグで追跡するスタイル

## 新規 / 変更ファイル一覧

| ファイル | 操作 | 内容 |
|---|---|---|
| `discord-bot/src/speakerUtils.js` | **新規** | 表示名解決・発言者プレフィックス生成・複数人判定ヘルパー |
| `discord-bot/src/handlers/threadMessageHandler.js` | 変更 | 発言者名を取得し履歴エントリに `speaker` を付与 |
| `discord-bot/src/commands/oCommand.js` | 変更 | 初回プロンプトにも `speaker` を付与 |
| `discord-bot/src/ollamaClient.js` | 変更 | history → messages 変換時に発言者プレフィックス適用、`summarizeHistory` への反映 |
| `discord-bot/config/prompts.yml` | 変更 | 複数人対応のシステムプロンプト断片を新キーで追加 |
| `discord-bot/src/prompts.js` | 変更 | 新キーの読み込みとエクスポート |
| `discord-bot/test/speakerUtils.test.js` | **新規** | ヘルパーの単体テスト |
| `discord-bot/test/threadMessageHandler.test.js` | 変更 | speaker 付与のテストケース追加 |
| `discord-bot/test/threadManager.test.js` | 変更 | 追加フィールド保持の確認テスト |
| `discord-bot/test/ollamaClient.*.test.js` | 変更 | messages 変換・要約・トークン概算のテスト |

## 実装方針

### 履歴形式の拡張

```js
// 現行: { role: 'user', text: '...' }
// 拡張: { role: 'user', text: '...', speaker: '表示名' }   ← speaker は任意（後方互換）
```

- **生データは汚さない**: 履歴には `text` をそのまま保存し、`speaker` を別フィールドで持つ。LLM への埋め込み（`【Alice】...` 形式）は `ollamaClient.js` の変換時に行う
  - 理由: 要約・トークン概算・デバッグログで生テキストを使い回せる。書き込み時に埋め込む方式だと要約プロンプトやログに二重管理が発生する

### 発言者名の取得方法（Discord API 制限含む）

`speakerUtils.js` に解決関数を実装:

```js
export function resolveSpeakerName(message) {
    return (
        message.member?.displayName ||      // サーバーニックネーム優先（キャッシュ済みの場合のみ）
        message.author?.globalName ||       // Discord のグローバル表示名
        message.author?.username ||         // フォールバック
        'ユーザー'
    );
}
```

注意点:
- `message.member` は**キャッシュに無いと `null`** になり得る（intents に `GuildMembers` が無いため頻出）。現在の intents（Guilds / GuildMessages / MessageContent）ではメンバーイベントを受け取らないため、`member` が null の場合は `globalName` / `username` にフォールバックする設計とする
- `guild.members.fetch(id)` での解決は API レート制限と追加の失敗経路を生むため**非推奨**。フォールバックで十分（表示名が多少違っても会話文脈には支障がない）
- `globalName` は null の場合がある（旧アカウント等）ため必ず `username` までフォールバック
- サニタイズ: プレフィックス化する際、表示名に改行や Markdown が含まれる可能性を考慮し、改行を空白に置換 + 長さ上限（例: 32 文字）で切り詰め

### 単一ユーザー時との後方互換性

**「スレッド内の user 発言の speaker が 1 種類（または全員 speaker なし）なら何もしない」** 方針:

```js
// speakerUtils.js
export function isMultiUserHistory(history) {
    const speakers = new Set(
        history.filter(m => m.role === 'user' && m.speaker).map(m => m.speaker)
    );
    return speakers.size > 1;
}

export function formatEntryForLlm(entry, multiUser) {
    if (!multiUser || entry.role !== 'user' || !entry.speaker) {
        return { role: entry.role === 'user' ? 'user' : 'assistant', content: entry.text };
    }
    return {
        role: 'user',
        content: `【${entry.speaker}】${entry.text}`
    };
}
```

- 既存スレッド（チケット6以前に作られた `{ role, text }` のみの履歴）や、単一ユーザーのスレッドでは**現行と完全に同じプロンプト**になる → 回帰リスク最小
- 複数人判定は `generate()` 呼び出し毎に O(n) で計算（履歴は高々数十件なのでコスト無視可能）

### `ollamaClient.js` の変更点

1. **finalMessages 構築（L128-142）**: `processedHistory.map(...)` を `formatEntryForLlm` 経由に置換。`isMultiUserHistory(processedHistory)` を一度計算して渡す
2. **トークン概算（L73-77）**: 複数人時はプレフィックス分のトークンも概算に含めるべき。`estimateTokensFromHistory` 内で複数人判定し、`estimateTokensFromText(\`【${m.speaker}】${m.text}\`)` を使う（過大評価側に倒すのは現行の「安全寄り」方針と一致）
3. **summarizeHistory（L672+）**: `history.map(m => \`${m.role}: ${m.text}\`)` を `\`${m.role}${m.speaker ? \`(${m.speaker})\` : ''}: ${m.text}\`` に変更。要約にも誰が何を言ったかが残る
4. **システムプロンプトの動的差し込み**: 後述の通り、複数人時のみ `SYSTEM_PROMPT + MULTI_USER_PROMPT` を使用

### システムプロンプトの拡張方針

`prompts.yml` に新キーを追加（既存 `system` は**変更しない**）:

```yaml
  # 複数人が会話している場合に system プロンプトに追記する文言
  multiUserSystem: |-
    【複数人モード】
    この会話には複数のご主人様が参加しています。
    各ユーザー発言には【発言者名】が付いています。

    - 全員を「ご主人様」と呼ぶ絶対ルールは変わりません。
    - 発言者名を会話の中で区別し、必要に応じて「〇〇のご主人様」のように参照してください。
    - 直前の質問をしたご主人様に回答することを最優先してください。
    - 別のご主人様への以前の発言を文脈として利用できますが、宛先を取り違えません。
    - 発言者名を勝手に省略・変更しません。
```

`prompts.js` は新キーの読み込みとエクスポートを追加。`ollamaClient.js` の `finalMessages` で:

```js
const systemPrompt = multiUser ? `${SYSTEM_PROMPT}\n\n${multiUserSystemPrompt}` : SYSTEM_PROMPT;
```

> 設計判断ポイント: 「全員をご主人様のまま、名前で識別可能にする」案を採用。名前呼び捨てに切り替える案は「ご主人様を呼び捨てにしません」の絶対ルールと衝突するため不採用。

### ハンドラ側の変更（`threadMessageHandler.js`）

```js
import { resolveSpeakerName } from '../speakerUtils.js';

// processThreadMessage 内
addToThreadHistory(threadId, {
    role: 'user',
    text: message.content,
    speaker: resolveSpeakerName(message)
});
```

DI 可能にするため `resolveSpeakerName` も deps のデフォルト値に含める（既存テストパターンに準拠）。`oCommand.js` の初回登録も同様に `speaker: resolveSpeakerName(interaction)` 相当（`interaction.member?.displayName ?? interaction.user?.globalName ?? interaction.user?.username`）を追加。

## テスト計画

### `test/speakerUtils.test.js`（新規）
- `resolveSpeakerName`: member.displayName > globalName > username > 'ユーザー' の優先順位
- member が null の場合のフォールバック
- 改行を含む表示名のサニタイズ、長すぎる表示名の切り詰め
- `isMultiUserHistory`: 2 種類の speaker で true / 1 種類で false / speaker なしだけで false / assistant のみで false
- `formatEntryForLlm`: 複数人時のプレフィックス付与、単一人時の素通し、assistant エントリは常に素通し

### `test/threadMessageHandler.test.js`（変更）
- モック message（`member.displayName` あり/なし）で `addToThreadHistory` に `speaker` 付きエントリが渡ること
- deps で `resolveSpeakerName` を注入できること
- 既存テスト： `addToThreadHistory` の呼び出し引数に `speaker` が増える影響を受けるケースがあれば修正

### `test/threadManager.test.js`（変更）
- `addToThreadHistory` / `setThreadHistory` が `speaker` など追加フィールドを保持すること
- 防御的コピー後に追加フィールドが欠落しないこと

### `test/ollamaClient.http.test.js` / `comprehensive.test.js`（変更）
- 複数人履歴 → Ollama リクエストの `messages` に `【名前】` プレフィックス付き content が含まれること
- 単一人履歴 → リクエスト payload が**現行と同一**であること（後方互換の回帰テスト）
- 複数人時のみ system メッセージに複数人モード断片が追記されること
- 要約発火時に `summarizeHistory` への入力に `(speaker)` が含まれること
- トークン概算がプレフィックス分を含むこと（境界値テスト）

## 懸念点・注意事項

1. **プライバシー**: 表示名が LLM へ送信される（ローカル Ollama とはいえ、検索プロンプト等に紐づく可能性）。ニックネームはサーバー内公開情報であり実害は小さいが、README で明記推奨。ユーザー ID は送らず表示名のみに限定する
2. **トークン増加**: プレフィックスは 1 発言あたり数トークン。12000 トークン閾値の概算に織り込むことで実害なし。ただし長い表示名は切り詰める
3. **表示名の不安定さ**: ユーザーが途中でニックネームを変えると同一人物が別 speaker に見え、「単一人判定」が崩れて複数人モードが発火する。実害は軽微（プレフィックスが付くだけ）だが挙動として認識しておく
4. **`member` キャッシュ不在**: intents に `GuildMembers` がないため `member` は null になりやすい。フォールバック設計で吸収する（intent 追加は特権 Intent 審査の対象になりうるため避ける）
5. **既存テストの deepEqual**: `threadManager.test.js` 等でエントリ全体比較をしている箇所があり、ハンドラ側の変更とセットで修正が必要
6. **プロンプトの文字数**: `multiUserSystem` の追記で system プロンプトが膨らむ。簡潔に保つ
7. **検索判定プロンプト（decisionPrompt）**: 検索判断は最新 prompt のみで行われるため複数人対応の変更不要。ただし「誰の質問か」が検索クエリ品質に影響するケースは現状無視できる範囲

## 工数内訳

- 変更ファイルは 6〜7 ファイルと幅広いが、各変更は小規模（ヘルパー抽出 + マッピング置換 + YAML 追記）
- 後方互換を「単一人時は何もしない」で確保できるため、リグレッション検証は既存テストの payload 同一性確認でカバー可能
- テスト追加が全体の半分程度のボリューム（新規 1 ファイル + 既存 3〜4 ファイル更新）

実装だけなら S、テスト込み・lint（Biome `--error-on-warnings`）・`make test` 全件パスまで含めると M。
