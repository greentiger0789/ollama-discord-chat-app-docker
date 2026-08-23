# チケット1: 会話のリセット・管理コマンド

## 概要

スレッド内の会話履歴を操作するコマンド群と、スレッド名の自動生成を実装する。

- `/o-reset`: スレッド内で実行すると会話履歴をクリア
- `/o-summary`: これまでの会話の要約を出力
- スレッド名自動生成: プロンプト先頭からスレッド名を生成（現在は `o-${username}-${Date.now() % 10000}`）

**工数感: M**

## 現状の関連コード

### `discord-bot/src/threadManager.js`（全 45 行）
- モジュールスコープの `Map`（`threadHistory`）で履歴を管理。**永続化なし、プロセス内のみ**
- 履歴エントリ形式: `{ role: 'user' | 'assistant', text: string }`
- 既存 API:
  - `getThreadHistory(threadId)` — 防御的コピーを返す（存在しなければ `[]`）
  - `setThreadHistory(threadId, history)`
  - `addToThreadHistory(threadId, message)`
  - `initializeThread(threadId, initialMessage?)` — 上書き動作
  - **`clearThreadHistory(threadId)` — 既に実装済み（L37-39）**。`/o-reset` はこれをそのまま使える
  - `getAllThreadIds()`
- テストはクエリパラメータ付き動的 import で毎回 fresh import

### `discord-bot/src/commands/oCommand.js`（全 71 行）
- パターン: `createHandleOCommand(deps = defaultDeps)` ファクトリ + デフォルト export の後方互換
- スレッド作成フロー: `deferReply()` → `followUp('スレッドを作成しました')` → `replyMsg.startThread({ name, autoArchiveDuration: 60 })` → `initializeThread` → `thread.send(...)` → thinking メッセージ → `generateResponse(prompt, history)` → `sendSplitMessage`
- スレッド名は L41: `` `o-${interaction.user.username}-${Date.now() % 10000}` ``

### `discord-bot/src/discordClient.js`
- コマンド定義は生のオブジェクト配列 `commands`（L26-38）。`/o` のみ
- `createRegisterCommands({ client, restClient, guildId, routes, commandList })` ファクトリ。guild ID があれば guild 固有登録、なければグローバル登録
- **新コマンド追加手順**: `commands` 配列にオブジェクトを追加するだけ（REST PUT で全件上書き登録される）

### `discord-bot/index.js`
- `interactionCreate` で `interaction.commandName !== 'o'` をガードして `handleOCommand` へ（L22-27）
- 新コマンドはここに分岐追加が必要

### `discord-bot/src/handlers/threadMessageHandler.js`
- `handleThreadMessage(message, deps)` — スレッド判定 → スレッド単位タスクキュー（`enqueueThreadTask`）→ `processThreadMessage`
- deps 注入パターン採用。**キュー機構があるため `/o-reset` `/o-summary` も同じキューに載せるべき**（履歴クリアと進行中の応答の競合防止）

### `discord-bot/src/ollamaClient.js`
- `generateResponse(prompt, history, model)`（L664）— メイン応答生成
- **`summarizeHistory(client, model, history)`（非 export、L672 付近）が既存！** 「会話履歴を簡潔に要約」プロンプト + `temperature: 0, num_predict: 512, think: false` で `postChat` を呼ぶ。`/o-summary` はこれを export 化して再利用するのが最適
- `truncate(text, maxLength)`（L625）もあり

### `discord-bot/config/prompts.yml` / `src/prompts.js`
- `prompts.system` / `prompts.decision` / `prompts.searchNotices` を必須検証付きで読み込み
- 新プロンプト（summary 用、threadName 用）は `prompts.yml` に追記し、`prompts.js` の `loadPrompts()` に optional なキーとして追加する形が規約に合致

## 新規 / 変更ファイル一覧

| ファイル | 操作 | 内容 |
|---|---|---|
| `discord-bot/src/commands/resetCommand.js` | **新規** | `/o-reset` ハンドラ |
| `discord-bot/src/commands/summaryCommand.js` | **新規** | `/o-summary` ハンドラ |
| `discord-bot/src/threadNaming.js` | **新規** | スレッド名自動生成ロジック |
| `discord-bot/src/discordClient.js` | 変更 | `commands` 配列に `/o-reset`, `/o-summary` を追加 |
| `discord-bot/index.js` | 変更 | `interactionCreate` 分岐に新コマンド追加 |
| `discord-bot/src/commands/oCommand.js` | 変更 | スレッド名自動生成を組み込み |
| `discord-bot/src/ollamaClient.js` | 変更 | `summarizeConversation(history)` を export として公開 |
| `discord-bot/src/prompts.js` | 変更 | `summary` / `threadName` プロンプト読み込み対応 |
| `discord-bot/config/prompts.yml` | 変更 | `summary`, `threadName` プロンプト追記 |
| `discord-bot/test/oResetCommand.test.js` | **新規** | |
| `discord-bot/test/oSummaryCommand.test.js` | **新規** | |
| `discord-bot/test/threadNaming.test.js` | **新規** | |
| `discord-bot/test/discordClient.test.js` | 変更 | コマンド定義数・内容の検証追加 |

## 実装方針

### `/o-reset`

```js
// src/commands/resetCommand.js
export function createHandleOResetCommand(deps = defaultDeps) { ... }
export const handleOResetCommand = createHandleOResetCommand();
```

処理フロー:
1. `interaction.channel.isThread()` 判定。スレッド外なら `reply({ content: '...', ephemeral: true })` で終了
2. `clearThreadHistory(threadId)` 呼び出し（既存関数）
3. `interaction.reply({ content: '会話履歴をリセットしました、ご主人様♡', ephemeral: false })`

**重要**: `threadMessageHandler.js` の `enqueueThreadTask` と同じキュー機構を使い、進行中の応答生成完了後にクリアを実行すること。現状キューはハンドラ内部 private なので:

- **推奨案 A**: `enqueueThreadTask` を export し、reset/summary コマンドからも利用する
- 案 B: reset コマンドは即時実行（Map 操作だけなので競合の影響は「クリア直後に古い history で応答が 1 回返る」程度。ただし UX が悪い）

### `/o-summary`

```js
export function createHandleOSummaryCommand(deps = defaultDeps) { ... }
```

deps: `getThreadHistory`, `summarizeConversation`, `sendSplitMessage`, `buildMaidThinkingMessage`

処理フロー:
1. スレッド判定（同上）
2. `getThreadHistory(threadId)` 取得。空なら「まだ会話がありません」と reply して終了
3. `deferReply()` → thinking メッセージ送信
4. `const summary = await summarizeConversation(history)` 呼び出し
5. `sendSplitMessage(interaction.channel, summary, thinkingMsg)` で送信（1900 文字分割を再利用）

`ollamaClient.js` 側:

```js
export async function summarizeConversation(history, model = OLLAMA_MODEL) {
    return await summarizeHistory(defaultClient, model, history);
}
```

既存 private 関数 `summarizeHistory` の薄いラッパーとして公開。プロンプトは `config/prompts.yml` の `prompts.summary` に外部化（規約「設定の外部化」準拠）。

### スレッド名自動生成

**推奨案: プロンプト先頭 N 文字切り出し（LLM 不使用）**

```js
// src/threadNaming.js
export function generateThreadName(prompt, username, { maxLength = 30 } = {}) {
    const cleaned = prompt.replace(/\s+/g, ' ').trim();
    if (!cleaned) return `o-${username}`;
    let name = cleaned.slice(0, maxLength);
    // サロゲートペア絵文字で途切れないよう調整
    if (cleaned.length > maxLength && /[\uD800-\uDFFF]$/.test(name)) name = name.slice(0, -1);
    return `${name}${cleaned.length > maxLength ? '…' : ''}`;
}
```

理由:
1. **速度**: `/o` 実行時に LLM で名前生成すると初回応答が数秒〜十数秒遅延する（スレッド作成は応答前に必要なため直列になる）
2. **コスト**: 名前生成のためだけに GPU 推論 1 回分を消費するのは非効率
3. **Discord 制限**: スレッド名は最大 100 文字だが、短く切り出した方が視認性が良い
4. LLM 生成は将来の拡張（オプション化）として後回し可能。`models.yml` の `num_predict` を小さくした別呼び出しが必要になり複雑度が上がる

### discordClient.js / index.js の変更

`discordClient.js` の `commands` 配列に追加:

```js
{ name: 'o-reset', description: 'このスレッドの会話履歴をリセットします' },
{ name: 'o-summary', description: 'これまでの会話の要約を出力します' }
```

`index.js` の `interactionCreate` ハンドラを switch/dispatch 形式に変更:

```js
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    switch (interaction.commandName) {
        case 'o': return await handleOCommand(interaction);
        case 'o-reset': return await handleOResetCommand(interaction);
        case 'o-summary': return await handleOSummaryCommand(interaction);
    }
});
```

## テスト計画

既存パターンに倣う: `node:test` + `assert/strict`、DI によるモック注入、fresh import パターン。

### `test/oResetCommand.test.js`
- スレッド外実行時は ephemeral エラー reply され `clearThreadHistory` が呼ばれない
- スレッド内実行時は `clearThreadHistory` が正しい threadId で呼ばれる
- 成功メッセージが reply される
- `clearThreadHistory` が throw した場合のエラーハンドリング
- fresh import した実 `threadManager` との統合テスト（履歴セット→reset→空確認）

### `test/oSummaryCommand.test.js`
- スレッド外実行時のエラー応答
- 履歴が空の場合は要約生成を呼ばずに応答
- 履歴が渡され `summarizeConversation` に正しい history が渡る
- 要約結果が `sendSplitMessage` に渡る
- 要約失敗時のエラーハンドリング

### `test/threadNaming.test.js`
- 通常プロンプトからの切り出し
- 30 文字超で末尾 `…` 付与
- 空白正規化・trim
- 絵文字（サロゲートペア）含みで途中切断されない
- 空文字列プロンプトでフォールバック名

### `test/discordClient.test.js`（変更）
- `commands` リストに `o-reset` / `o-summary` が含まれること

### `test/oCommand.test.js`（変更）
- スレッド作成時に `startThread` へ自動生成名が渡ることの検証

検証コマンド: `make test`（= `LOG_LEVEL=silent node --test`）、`make lint-js`（Biome `--error-on-warnings` のため警告ゼロ必須）

## 懸念点・注意事項

1. **Discord スレッド名制限**: 最大 100 文字。30 文字 + `…` なら安全
2. **ephemeral の挙動**: `deferReply({ ephemeral: true })` にすると followUp も ephemeral になる。`/o-summary` は結果を共有したいので non-ephemeral 推奨
