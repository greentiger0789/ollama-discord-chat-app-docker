# チケット3: メンション対応

## 概要

スレッド外で Bot をメンションしたら、その場で簡易応答する（スレッドを作らないライトモード）。

- メンション内容から Bot のメンション部分を除去してプロンプト化
- 会話履歴はチャンネル単位で管理（メンション応答のペアのみ記録）

**工数感: M**（検索無効化オプション `skipSearch` まで含める場合は M+）

## 現状の関連コード

### `discord-bot/index.js`
- **L26-30**: `interactionCreate` で `/o` コマンドを処理
- **L35-37**: `messageCreate` イベントで `handleThreadMessage(message)` を呼ぶだけ。**スレッド外のメッセージは `threadMessageHandler.js` 内で早期リターンされ、完全に無視されている**
- ハンドラ登録は `client.on(...)` の直書き。DI パターンではない

### `discord-bot/src/discordClient.js`
- **L18-24**: intents 設定は `Guilds` / `GuildMessages` / `MessageContent` のみ
  - **メンション検出には十分**。`message.mentions.has(client.user)` や `<@BOT_ID>` のパースはこれらの intents で可能（メンション情報は MESSAGE_CREATE イベントに含まれるため `GuildMentions` intent は不要）
- `createRegisterCommands` の DI ファクトリパターン（L41-）がテスト容易性の参考になる

### `discord-bot/src/handlers/threadMessageHandler.js`
- **L8-12**: `handleThreadMessage` — 非スレッド(`!isThread()`)と bot メッセージで早期リターン
- **L14-27**: `enqueueThreadTask` — スレッド ID 単位の直列キュー（応答の順序保証）
- **L29-**: `processThreadMessage` — deps 注入パターン。履歴追加 → thinking メッセージ送信 → `generateResponse(content, history)` → 履歴追加 → 分割送信
- エラー時は `'エラーが発生しました。'` を送信

### `discord-bot/src/ollamaClient.js`
- **L664-669**: `generateResponse(prompt, history, model)` — モジュールスコープのデフォルトクライアントに委譲
- **L57-230 付近**: `generate()` 内部フロー: ①トークン概算 → ②履歴要約(12000 トークン超過時) → ③`decideSearchPlan` による検索判定 → ④プロンプト構築 → ⑤本推論
- **L236-297 付近**: `decideSearchPlan` — 強制キーワード（今日/最新/天気 等）+ LLM による JSON 判定。Tavily / DuckDuckGo フォールバック付き
- 検索実行時は返信先頭に検索済み通知（`prependSearchNotice`）が付く

### `discord-bot/src/messageUtils.js`
- `buildMaidThinkingMessage()`（L4-47）、`sendSplitMessage(channel, text, firstMessageToEdit)`（L49-75、1900 文字分割）

### `discord-bot/src/threadManager.js`
- モジュールスコープ `Map` による履歴管理。API は `get/set/addTo/initialize/clearThreadHistory` + `getAllThreadIds`。**キーはスレッド ID だがチャンネル ID を入れてもそのまま動作する**（単なる Map のため）

### 既存テストのパターン
- `test/threadMessageHandler.test.js`: DI でモック注入し「依存関数が呼ばれたか/呼ばれないか」を assert。非同期処理の順序確認に `createDeferred` を使用
- `test/discordClient.test.js`: クエリパラメータ付き動的 import で fresh import（モジュール状態リセット）。env 変数の保存・復元パターン

## 新規 / 変更ファイル一覧

| ファイル | 新規/変更 | 内容 |
|---|---|---|
| `discord-bot/src/handlers/mentionHandler.js` | **新規** | メンション検出・プロンプト抽出・簡易応答ハンドラ |
| `discord-bot/index.js` | 変更 | `messageCreate` でメンションハンドラを先に呼び、未処理なら `handleThreadMessage` へ |
| `discord-bot/src/messageUtils.js` | 変更（任意） | `extractMentionPrompt(content, clientId)` をここに置くか、mentionHandler 内に置く |
| `discord-bot/test/mentionHandler.test.js` | **新規** | メンションハンドラのテスト |
| `discord-bot/test/index.test.js` | 新規（任意） | ハンドラ振り分けの統合テスト（既存になければ省略可） |

※ `discordClient.js` / `ollamaClient.js` / `threadManager.js` は**変更不要**。

## 実装方針

### メンション検出方法（推奨案）

```js
// mentionHandler.js
export function createHandleMentionMessage({ clientUserId, ...deps } = {}) { ... }

export async function handleMentionMessage(message, deps = {}) {
    if (!message.guild && !message.channel) return;        // 保険
    if (message.author.bot) return;
    if (message.channel.isThread()) return;                // ★競合回避
    if (!message.mentions?.has?.(clientId)) return;        // Bot宛てメンション以外は無視
    ...
}
```

- 判定は **`message.mentions.has(client.user.id)` を第一候補**とし、テスト容易性のため `deps.clientId` として注入可能にする。フォールバックとして `content.includes(`<@${clientId}>`)` も併用可能
- DM（`message.guild === null`）への対応有無はオプション化（初期実装はギルドのみでもよい）

### プロンプト抽出

```js
export function extractMentionPrompt(content, clientId) {
    return (content || '')
        .replaceAll(new RegExp(`<@!?${clientId}>`, 'g'), '')
        .trim();
}
```

- `<@ID>` と `<@!ID>`（ニックネーム表記）両方に対応する正規表現
- 抽出後に空文字列になった場合（メンションのみのメッセージ）は、「ご主人様、なにかご用でしょうか？」等の固定挨拶を返すか無視するかを選択 → **推奨： 固定挨拶応答**（LLM を呼ばないので軽量）
- 他ユーザーへのメンションが混在する場合はそのまま残す（Bot 自身の分のみ除去）

### 履歴管理方針 — **推奨: 「チャンネル単位の履歴」を採用**

| 案 | メリット | デメリット |
|---|---|---|
| A. チャンネル単位の履歴 | 文脈を踏まえた自然な連続会話ができる。`threadManager.js` をそのまま流用でき変更コスト最小 | チャンネル内の他の話題も混ざる可能性（メンション時のみ記録すれば実質問題なし） |
| B. 履歴なし都度応答 | 実装が最も簡単、状態を持たない | 「さっきの話だけど…」に対応できない。体験が劣化 |

**理由**:
1. `threadManager.js` は単なる `Map<key, history>` なので、**チャンネル ID をキーにしてそのまま再利用できる**（API 変更不要）
2. `generateResponse(prompt, history)` は history 配列を受け取る設計済みで、空配列も許容する
3. 記録方針: **メンションで応答した user/assistant のペアのみをチャンネルキーで記録**する。チャンネル内の全メッセージを記録しないことで、Bot 関係のない会話が文脈に混入する問題を回避しつつ、メイドちゃんとの連続対話は成立する
4. 将来のメモリ肥大対策として、既存の 12000 トークン超過時の要約ロジック（`ollamaClient.js` ②）がそのまま効くため追加実装不要

### Web 検索の扱い — **推奨: 使う（ただしライトモード考慮で設定化）**

- `generateResponse` は内部で `decideSearchPlan` を自動実行するため、**コード変更なしでメンション応答でも検索が働く**
- ただし「簡易応答（ライトモード）」という位置づけなら、検索 + 本推論で 2 回の LLM 呼び出しとなり応答が遅くなる
- 対応案: env（例: `MENTION_ENABLE_SEARCH=false`）でメンション時の検索を無効化できるようにする。無効化する場合は `generateResponse` にオプション引数 `{ skipSearch: true }` を追加する拡張が必要（ollamaClient への小規模変更が発生）
- **初回実装はデフォルトで検索あり**（既存動作と一貫）、設定での無効化を拡張タスクとするのが無難

## スレッド内メンションとの競合回避（二重応答防止）

現在 `index.js` の `messageCreate` は `handleThreadMessage` のみに渡っている。競合シナリオ:

1. **スレッド内でメンションした場合** → `handleThreadMessage` が処理すべき。メンションハンドラが反応すると二重応答になる
2. **解決策（二重防御）**:
   - `mentionHandler.js` 側で `if (message.channel.isThread()) return;` を明示
   - `index.js` の振り分けを明確にする:

```js
client.on('messageCreate', async message => {
    // スレッド内 → 従来のフォローアップ処理
    if (message.channel.isThread()) {
        await handleThreadMessage(message);
        return;
    }
    // スレッド外でメンション → ライトモード簡易応答
    await handleMentionMessage(message, { clientId: client.user.id });
});
```

   - さらに安全側として、`handleMentionMessage` 内部にも `isThread()` ガードを残す（ハンドラ単体で正しく動作する保証 = テスト容易性）
3. **bot メッセージガード**: `message.author.bot` を最初にチェック（他ボットや自分自身の応答への連鎖反応防止）

## テスト計画

### `discord-bot/test/mentionHandler.test.js`（新規）

既存パターンに倣い DI モック + `node:test` + `assert/strict` で実装。

**構造テスト**
- `handleMentionMessage` が関数として export されている
- `extractMentionPrompt` が純粋関数として export されている

**`extractMentionPrompt` テストケース**
- `<@123456789012345678> 今日の天気は？` → `今日の天気は？`
- `<@!123456789012345678> おはよう` （! 付き表記）→ `おはよう`
- 複数メンション混在（自分 + 他人）→ 自分の分のみ除去され他人のメンションは残る
- メンションのみ（本文なし）→ 空文字列
- null / undefined コンテンツ → 空文字列（クラッシュしない）
- 前後に空白・改行 → trim される

**`handleMentionMessage` テストケース**
- 非スレッド + Bot 宛メンション → deps（`generateResponse`, `sendSplitMessage`, `addToThreadHistory`, `getThreadHistory`）がすべて呼ばれる
- スレッド内メッセージ → 何も呼ばれない（早期リターン）
- bot 作者のメッセージ → 何も呼ばれない
- メンションなし → 何も呼ばれない
- メンションのみ（プロンプト空）→ `generateResponse` が呼ばれず固定応答が送信される
- 正常系: プロンプト抽出結果が `generateResponse` に渡ること、history が `getThreadHistory(channel.id)` から取得されること
- 応答後: assistant 応答が `addToThreadHistory(channel.id, { role: 'assistant', text })` に記録される
- エラー系: `generateResponse` が throw → `'エラーが発生しました。'` が送信される（既存 handler と同一挙動）

### `discord-bot/test/index.test.js`（任意・新規）
- index.js はハンドラ登録のみで薄いため、優先度低。振り分けロジックをテストしたい場合は小さな `routeMessage(message, handlers)` 関数として切り出してテストするのが現実的

### 回帰確認
- `make test`（全件）+ `make lint-js`（Biome、警告でも落ちる点に注意）

## 懸念点・注意事項

1. **他ボットへの連鎖反応**: `author.bot` ガードは必須。ボット同士がメンションで無限ループする事故を防ぐ。自ボット自身のメッセージも当然除外
2. **レート制限・負荷**: チャンネルで頻繁にメンションされると LLM 呼び出しが多発する。スレッド版にあるような **チャンネル単位の直列キュー**（`enqueueThreadTask` と同様の仕組み）をメンション側にも適用することを推奨。加えて、連投に対する簡易クールダウン（例: 同一ユーザー 5 秒以内の再メンションは無視 or 待機）は将来拡張として検討
3. **`mentions.has` の null 安全性**: テストでは生モックオブジェクトを使うため、`message.mentions?.has?.(...)` の optional chaining で防御するとモックが書きやすい（既存テストスタイルと整合）
4. **メンションのみのメッセージ**: 挨拶応答にするか無視するかはプロダクト判断。LLM を呼ばない分岐なのでコストはゼロ
5. **履歴の寿命**: チャンネル単位の履歴はプロセス再起動で消える（既存スレッド履歴も同様）。インメモリ前提であることを README/docs に明記
6. **検索の遅延**: メンション簡易応答で Tavily/DDG まで走ると体感が重い（タイムアウト 300 秒設定あり）。設定化を早めに入れる価値あり
7. **Discord 制限**: 応答は既存 `sendSplitMessage`（1900 字分割）を流用すれば問題なし
8. **`client.user.id` の取得タイミング**: `index.js` では ready 後でないと `client.user` が null の可能性があるため、ハンドラ内で `message.client.user.id` を参照するか、ready 後に clientId を束縛する設計にする

## 推奨実装サマリー

- 新規 `src/handlers/mentionHandler.js`（DI パターン、スレッド/bot ガード、チャンネル単位キュー）
- 履歴は **`threadManager.js` をチャンネル ID キーで再利用**（メンション応答のペアのみ記録）
- 検索は既存 `generateResponse` の自動判定に任せ、設定での無効化を拡張タスクとする
- `index.js` で `isThread()` により先行振り分けし、ハンドラ側にもガードを置く二重防御
