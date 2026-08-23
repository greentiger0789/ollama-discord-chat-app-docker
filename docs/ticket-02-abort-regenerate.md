# チケット2: 応答の中断・再生成

## 概要

「考え中…」メッセージにリアクションを付与し、ユーザーが操作できるようにする。

- ❌ リアクションで応答生成を**中断**（Ollama へのリクエストを AbortController で中止、履歴に assistant 応答を追加しない）
- 🔄 リアクションで**再生成**（最後の user メッセージに対して再度 `generateResponse` を実行）

**工数感: M（2〜3 日程度）**

## 現状の関連コード

### `discord-bot/src/ollamaClient.js` — generateResponse のシグネチャと fetch 構造

| 位置 | 内容 |
|---|---|
| L664-670 | `export async function generateResponse(prompt, history, model = OLLAMA_MODEL)` → `defaultClient.generate({ model, prompt, history })`。**signal パラメータは存在しない** |
| L55-60 | `createOllamaClient({ baseURL, searchFn, httpClient })`。HTTP クライアントは注入可能 |
| L152 | 本推論は `requestAssistantContentWithRetry(client, { model, messages, stream:false, options })` |
| L555-591 | `requestAssistantContentWithRetry` → `postChat(client, payload, { think:true })`（thinking-only 時のリトライで最大 2 回 postChat） |
| L723-746 | `createHttpClient({ baseURL, timeout, fetchImpl })` — `post(resource, data)` / `get(resource)` のみ。**引数に signal を渡す口がない** |
| L793-830 | `requestJson({ url, method, json, timeout, fetchImpl })` — 内部で `AbortController` を生成しタイムアウト用に使用。fetch には `signal: controller.signal` を渡しており、**外部 signal をマージすれば中止可能な構造**。ただし `AbortError` をすべて「timeout エラー」に変換してしまう（L819-824）ため、ユーザー中断とタイムアウトの区別が必要 |
| L753-771 | `postChat` — think 非対応時のリトライあり。両方の呼び出しに signal を伝播させる必要あり |

**結論**: `generateResponse → generate → requestAssistantContentWithRetry → postChat → client.post → requestJson` という 6 層の呼び出しチェーンがあり、各層に `signal` をオプションとして追加して伝播させる必要がある。

### `discord-bot/src/handlers/threadMessageHandler.js` — タスクキュー

| 位置 | 内容 |
|---|---|
| L7 | `const threadQueues = new Map()` — スレッドID → 最後のタスク Promise |
| L11-15 | `handleThreadMessage`: スレッド以外・bot メッセージを除外し `enqueueThreadTask` へ |
| L17-29 | `enqueueThreadTask`: 前タスクの完了を待って直列実行。**キャンセル機構は一切ない**（Promise チェーンなので実行中タスクは止められない） |
| L31-76 | `processThreadMessage`: user を履歴に追加（L45）→ thinking メッセージ送信（L49）→ `generateResponse`（L51）→ **成功時にのみ** assistant を履歴追加（L53）→ `sendSplitMessage`。catch で汎用エラー送信（L66-70） |

履歴への assistant 追加が `generateResponse` 成功後である点はチケット要件（中断時は履歴追加しない）と整合しており、abort 例外を catch して分岐すればよい。

### `discord-bot/src/commands/oCommand.js` — thinking メッセージ送信フロー

| 位置 | 内容 |
|---|---|
| L44-47 | スレッド作成後、プロンプトを履歴へ追加し `thread.send` で表示 |
| L50 | `const thinkingMsg = await thread.send(buildThinking())` — **ここで `thinkingMsg.react('❌')` / `.react('🔄')` を付与するのが自然なタイミング** |
| L52 | `generateResponse(prompt, history)` — ここに signal を渡す |
| L54-56 | 成功時のみ assistant 履歴追加 → `sendSplitMessage` |

依存関係は `createHandleOCommand(deps)` で注入可能な構造（L14-33）。

### `discord-bot/src/messageUtils.js`

- `buildMaidThinkingMessage()` (L4-42): ランダムな考え中メッセージ文字列を返すのみ
- `sendSplitMessage(channel, text, firstMessageToEdit = null)` (L45-69): 1900 文字以下なら `firstMessageToEdit.edit(text)`、超過なら最初のチャンクを edit し残りを `channel.send` で分割送信

### `discord-bot/src/discordClient.js` — intents 設定

L21-25: 現在の intents は **`Guilds`, `GuildMessages`, `MessageContent` のみ**。
→ リアクション受信には **`GatewayIntentBits.GuildMessageReactions`** の追加が必須。

### 既存テストのモックパターン

- `test/threadMessageHandler.test.js`: deps 全部をモック注入。モジュール状態を持つ `threadManager` はクエリパラメータ付き動的 import で fresh import
- `test/ollamaClient.test.js`: `createOllamaClient({ httpClient: mockHttpClient })` で `post/get` をモック
- `test/ollamaClient.http.test.js`: `requestJson` に `fetchImpl` を注入し、`signal.addEventListener('abort', ...)` で AbortError をシミュレートするパターンが既にある（L58-77）

## 新規 / 変更ファイル一覧

| ファイル | 新規/変更 | 内容 |
|---|---|---|
| `discord-bot/src/ollamaClient.js` | 変更 | signal 伝播（`generateResponse` / `generate` / `requestAssistantContentWithRetry` / `postChat` / `createHttpClient` / `requestJson`）、ユーザー中断エラー型の定義 |
| `discord-bot/src/generationRegistry.js` | **新規** | スレッド単位の進行中生成タスク管理（AbortController・thinkingMsg・meta を保持、cancel/regenerate API） |
| `discord-bot/src/handlers/threadMessageHandler.js` | 変更 | signal 生成・登録、abort 時の分岐（履歴追加スキップ・thinkingMsg 編集）、再生成ロジックの共通化 |
| `discord-bot/src/commands/oCommand.js` | 変更 | thinkingMsg へのリアクション付与、registry 登録、abort 時の分岐 |
| `discord-bot/src/handlers/reactionHandler.js` | **新規** | `messageReactionAdd` 処理（❌ 中断 / 🔄 再生成の振り分け） |
| `discord-bot/index.js` | 変更 | `client.on('messageReactionAdd', ...)` 登録 |
| `discord-bot/src/discordClient.js` | 変更 | `GatewayIntentBits.GuildMessageReactions` 追加 |
| `discord-bot/test/ollamaClient.abort.test.js` | **新規** | signal 伝播・abort エラー区別のテスト |
| `discord-bot/test/generationRegistry.test.js` | **新規** | レジストリ動作テスト |
| `discord-bot/test/reactionHandler.test.js` | **新規** | リアクション振り分けテスト |
| `discord-bot/test/threadMessageHandler.test.js` | 変更 | abort ケース追加 |

## 実装方針

### AbortController の伝播経路

```
reactionHandler / processThreadMessage
        │ AbortController を生成し registry に登録
        ▼
generateResponse(prompt, history, model, { signal })      ← 第4引数に options 追加
        ▼
defaultClient.generate({ model, prompt, history, signal })
        ▼
requestAssistantContentWithRetry(client, payload, { signal })
        ▼
postChat(client, payload, { think }, { signal })           ← think 非対応リトライにも同じ signal
        ▼
client.post(resource, data, { signal })
        ▼
requestJson({ url, method, json, timeout, signal, fetchImpl })
```

`requestJson` 内での外部 signal の扱い:

```js
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), timeout);
// 外部 signal があれば連結（Node 20+ の AbortSignal.any、CI は Node 26 なので利用可）
const combinedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
```

**重要**: 外部 signal による abort をタイムアウトと区別するため、catch 節で判定する:

```js
if (err.name === 'AbortError') {
    if (signal?.aborted) {
        const aborted = new Error('Request aborted by user');
        aborted.name = 'ResponseAbortedError';   // 独自エラー名
        throw aborted;
    }
    // 従来どおり timeout エラーに変換
}
```

さらに `summarizeHistory`（L684）と `decideSearchPlan`（L155 呼び出し）にも signal を渡し、**検索判定・要約フェーズでも中断できるようにする**（本推論前でもユーザーは待たされているため）。

### 進行中タスク管理（generationRegistry.js 新規）

```js
// イメージ
const activeGenerations = new Map(); // threadId -> { controller, thinkingMsg, kind, userId }

registerGeneration(threadId, { controller, thinkingMsg, kind, userId })
getGenerationByThinkingMessage(messageId)   // reaction から逆引き用
getGenerationByThread(threadId)
cancelGeneration(threadId)                  // controller.abort() + registry から削除
completeGeneration(threadId)
```

`threadQueues`（Promise 直列キュー）とは別にこの Map を持つ。Promise チェーンは実行中タスクを止められないため、**実際の停止は AbortController、順序制御は既存 enqueueThreadTask** という役割分担。

### リアクションイベントハンドラの設計（reactionHandler.js）

```js
export function createHandleReactionAdd(deps = {}) {
    return async function handleReactionAdd(reaction, user) {
        if (user.bot) return;                          // bot 自身のリアクション無視
        if (!['❌', '🔄'].includes(reaction.emoji.name)) return;

        // partial reaction/message への対応
        if (reaction.partial) await reaction.fetch().catch(() => null);
        const message = reaction.partial ? await reaction.fetch().then(r => r.message) : reaction.message;
        if (!message.channel?.isThread?.()) return;

        const entry = getGenerationByThinkingMessage(message.id);
        if (!entry) return;                            // 進行中の生成に紐づかないリアクションは無視

        if (reaction.emoji.name === '❌') {
            await handleCancel(entry, message, user);
        } else {
            await handleRegenerate(entry, message, user);
        }
    };
}
```

- **権限**: 必要に応じて `entry.userId === user.id` のみ許可（実行者限定）か、全員許可かを選択。デフォルトは実行者限定 + フォールバックでサーバー管理者を推奨
- **🔄 再生成フロー**:
  1. 進行中なら先に ❌ 相当で abort（または 🔄 を無視して「中断してから」と案内）
  2. 履歴から末尾の assistant エントリを削除（`threadManager.setThreadHistory` を利用。末尾が assistant でなければ何もしない）
  3. 最後の user メッセージの text を取り出し、既存の `processThreadMessage` 相当フローを `enqueueThreadTask` 経由で再実行（新しい thinkingMsg + 新しい AbortController で登録し直す）
  4. `processThreadMessage` を「prompt を明示的に渡せる」形にリファクタリングし、初回応答と再生成で処理を共通化する
- **中断後の UI**: thinkingMsg を `✖️ 中断しました。もう一度お尋ねください。` 等に編集し、付与したリアクションを `reactions.removeAll()`（権限がなければ `users.remove()`）で除去

### index.js / discordClient.js の変更

```js
// discordClient.js: intents に追加
GatewayIntentBits.GuildMessageReactions

// index.js:
import { handleReactionAdd } from './src/handlers/reactionHandler.js';
client.on('messageReactionAdd', async (reaction, user) => {
    await handleReactionAdd(reaction, user).catch(e => logger.error(...));
});
```

### oCommand.js の変更

L50 の `thinkingMsg` 送信直後に:

```js
await thinkingMsg.react('❌');
await thinkingMsg.react('🔄');
const controller = new AbortController();
registerGeneration(thread.id, { controller, thinkingMsg, kind: 'initial', userId: interaction.user.id });
const responseText = await generateResponse(prompt, history, undefined, { signal: controller.signal });
```

abort 時は catch で `ResponseAbortedError` を判別し、履歴追加をスキップして thinkingMsg を編集。`interaction.followUp` のエラー送信は行わない。

## 競合状態への対処

| 状態 | 対処 |
|---|---|
| 複数ユーザーが同時に ❌ を押す | `cancelGeneration` を冪等に（registry に存在しなければ no-op）。abort 済み controller への再 abort は安全 |
| ❌ と 🔄 がほぼ同時 | ハンドラ内で registry エントリを取得した時点で `completeGeneration`（取得=削除）し、二重実行を防ぐ。Map の get+delete はシングルスレッド Node では原子的 |
| 🔄 連打 | 再生成タスクも `enqueueThreadTask` で直列化。ただし同一スレッドで進行中タスクがある場合は新規受付を拒否し「処理中です」を ephemeral 返信する方が UX が良い |
| 中断後に届く遅延リアクション | registry からエントリ削除済みなら `getGenerationByThinkingMessage` が null を返し無視される |
| abort とレスポンス正常完了のレース | fetch 完了後に abort しても例外は発生しない → `processThreadMessage` 側で `signal.aborted` を再確認し、aborted なら履歴追加・送信をスキップ |
| partial reaction（再起動後の古いメッセージ） | `reaction.partial` / `reaction.message.partial` を fetch。registry に該当がなければ静かに無視 |

## テスト計画

### `test/ollamaClient.abort.test.js`（新規）
- `requestJson` に外部 signal を渡し abort すると `ResponseAbortedError`（name 判定）で reject される
- 外部 signal 未指定時は従来どおり timeout エラーに変換される（回帰確認）
- `generateResponse(prompt, history, model, { signal })` が `httpClient.post` まで signal を伝播する（mock post が第3引数で signal を受け取ることを assert）
- abort 後は `generate` が reject し、リトライ（thinking retry）が発火しない
- `summarizeHistory` / `decideSearchPlan` フェーズでも signal が渡る

### `test/generationRegistry.test.js`（新規）
- register → getByThinkingMessage / getByThread で取得できる
- cancelGeneration で controller.abort が呼ばれ、以降の getBy* は null
- completeGeneration 後は cancel が no-op（冪等性）
- 同一 threadId の上書き登録

### `test/reactionHandler.test.js`（新規）
- bot ユーザーのリアクションは無視
- 対象外絵文字は無視
- partial reaction が fetch されて処理される
- ❌: registry の該当エントリが abort され、thinkingMsg が編集される
- 🔄: 末尾 assistant が履歴から除かれ、最後の user プロンプトで再実行される（deps モックで検証）
- registry に紐づかないメッセージへのリアクションは無視
- 二重トリガー（同 messageId に 2 回）で 1 回しか実行されない

### `test/threadMessageHandler.test.js`（変更）
- generateResponse が `ResponseAbortedError` を throw → assistant 履歴に追加されないこと・thinkingMsg が編集されること・エラーメッセージ送信されないこと
- 完了後に `signal.aborted` が true の場合は送信しない（レース対策）

### `test/oCommand.test.js`（変更）
- thinkingMsg に react が 2 回呼ばれること
- abort 時に followUp エラーを出さないこと

## 懸念点・注意事項

1. **intents 追加の影響**: `GuildMessageReactions` は特権 intent ではないため再認証不要だが、**ボットの再起動が必要**。Docker 環境では `make up` のやり直しで反映
2. **Ollama API の abort 挙動**: node-fetch の abort はソケット切断であり、Ollama サーバー側はコンテキスト破棄で即座に推論を止める。ただし **非 stream (`stream:false`) のため、abort までの部分応答は破棄される**。部分テキスト保存までは本チケットのスコープ外とする
3. **`requestJson` の AbortError 変換**: 既存コードは全 AbortError を timeout に変換するため、ここを壊すと既存テスト `ollamaClient.http.test.js`（"Request timed out after"）が落ちる。外部 signal 由来のみ新エラー型にする実装順序に注意
4. **thinking retry との相互作用**: `requestAssistantContentWithRetry` は thinking-only 時に 2 回目の postChat を打つ。1 回目で abort されたらリトライせず即 reject すること（signal チェックを retry 条件に追加）
5. **`AbortSignal.any` の Node バージョン**: Node 20.3+。CI は Node 26、コンテナも新しいため問題ないが、`discord-bot/Dockerfile` のベースイメージ確認を推奨
6. **権限**: `reactions.removeAll()` / `users.remove()` には Manage Messages 権限が必要。権限不足時は catch して沈黙（ボットの機能には影響しない）
7. **oCommand の interaction ライフサイクル**: `/o` 初回応答の中断時、`interaction.deferReply()` 済みのため followUp で「中断しました」を返す選択肢もある。UX 要確認
8. **Biome 規約**: 行幅 100・末尾カンマなし・`asNeeded` アロー括弧。編集後は必ず `make lint-js` + `make test`

## 実装ステップ推奨

単一 PR で可能だが、2 段構成を推奨:

1. 先行コミット: ollamaClient の signal 伝播 + abort テスト
2. 後続コミット: generationRegistry + reactionHandler + UI（リアクション）

工数内訳:
- signal の 6 層伝播 + AbortError 区別: 0.5〜1 日（影響範囲が広く既存テスト保護が必要）
- generationRegistry + reactionHandler + 再生成フロー: 0.5〜1 日
- oCommand / threadMessageHandler 組み込み + intents: 0.5 日
- テスト 4 ファイル整備 + lint/test 通過: 0.5 日
