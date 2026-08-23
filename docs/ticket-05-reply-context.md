# チケット5: 返信メッセージへの文脈追加

## 概要

スレッド内でユーザーが特定の過去メッセージに「返信」した場合、その参照元メッセージの内容も文脈として LLM に渡す。

- 例: 「この部分について詳しく」と返信したら、参照元のメッセージ内容を含めて回答

**工数感: M（実装本体は約 30 行 + ヘルパー。テスト込みで半日〜1 日）**

## 現状の関連コード

### `discord-bot/src/handlers/threadMessageHandler.js`
- **L1-8**: 依存モジュールの import とロガー初期化。deps 注入パターンは `handleThreadMessage(message, deps)` の第2引数で実現
- **L10-13**: `handleThreadMessage` — スレッド以外・bot メッセージは早期リターンし、`enqueueThreadTask` でスレッド単位の直列キューに投入
- **L15-31**: `enqueueThreadTask` — スレッドごとに Promise チェーンでタスクを直列化
- **L33-76**: `processThreadMessage(message, deps)`
  - **L34-41**: deps のデフォルト解決（`buildMaidThinkingMessage` / `sendSplitMessage` / `generateResponse` / `addToThreadHistory` / `getThreadHistory`）。**ここに参照解決用の dep を追加するのが自然**
  - **L44-52**: 履歴取得とログ出力
  - **L54-57**: `addToThreadHistory(threadId, { role: 'user', text: message.content })` — **参照元を合成すべき場所**
  - **L61**: `generateResponse(message.content, history)` — **プロンプトにも参照元を含めるべき場所**
  - **L63-66**: assistant 応答を履歴に追加

### `discord-bot/src/discordClient.js`
- **L17-22**: intents 設定。`Guilds` / `GuildMessages` / `MessageContent` の3つ。**返信参照の解決にはこれで十分**

### `discord-bot/index.js`
- **L35-37**: `messageCreate` → `handleThreadMessage` に全委譲。変更不要

### `discord-bot/src/threadManager.js`
- 履歴エントリは `{ role, text }` のみ。`cloneMessage` はシャローコピー（L2-4）

### `discord-bot/src/ollamaClient.js`
- **L143-146**: `processedHistory.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }))` — **history → messages 変換は `role` と `text` のみを見る**。未知フィールドは無視される
- **L110-140**: トークン概算と履歴要約。`estimateTokensFromHistory` も `m.text` のみ参照
- **L664-671**: `generateResponse(prompt, history, model)` エクスポート

### 既存テストのパターン
- `test/threadMessageHandler.test.js`: モックメッセージは `{ channel: { isThread, id, send }, author: { bot }, content }` の最小構成。**`reference` プロパティは存在しない**ため、新コードは `message.reference` が undefined でも安全である必要あり
- fresh import パターン、deps トラッキング、`assert.deepEqual` による履歴エントリ検証が既存パターン

## discord.js v14 での reference / fetchReference

- `message.reference` は `MessageReference` オブジェクト（`messageId`, `channelId`, `guildId` を持つ）。返信でない場合は `null`
- `message.fetchReference()` で参照元 `Message` を取得可能（内部で REST API 呼び出し）
- **intents 追加は不要**: `reference` データは `messageCreate` イベントのペイロードに常に含まれ、`fetchReference()` は REST 経由のため Gateway intent に依存しない。既存の `MessageContent` intent により参照元メッセージの `content` も取得できる
- 注意: 参照先が削除済みの場合、`fetchReference()` は `DiscordAPIError`（code 10008 Unknown Message）を throw する

## 新規 / 変更ファイル一覧

| ファイル | 操作 | 内容 |
|---|---|---|
| `discord-bot/src/handlers/threadMessageHandler.js` | 変更 | 参照解決 + プロンプト合成 |
| `discord-bot/src/messageUtils.js` | 変更（推奨） | 引用整形ヘルパー `formatQuotedReference` を追加（テスト容易性のため） |
| `discord-bot/test/threadMessageHandler.reference.test.js` | 新規 | 参照解決のテスト |
| `discord-bot/test/messageUtils.test.js` | 変更 | 引用整形ヘルパーのテスト追加 |
| `discord-bot/src/discordClient.js` | **変更不要** | intents は現状で十分 |

## 実装方針

### 履歴形式への組み込み方針：「プロンプト合成」を採用

2案の比較:

- **案A（採用）: ユーザーテキストに引用を埋め込む**
  - `processThreadMessage` 内で `composedText = buildReplyPrompt(message.content, refContent)` を作り、それを `generateResponse` と `addToThreadHistory` の両方に渡す
  - メリット: `ollamaClient.js` の変更ゼロ。履歴の `text` に引用が残るため、以降のターンでも文脈が保持され、トークン概算・要約ロジックも自動的に機能する
- 案B: 履歴エントリに `context` フィールドを追加し `generate()` のマッピングを拡張
  - デメリット: `ollamaClient.js` の3箇所（マッピング・トークン概算・要約）の改修が必要。要約時には `context` が失われる。不採用

### `processThreadMessage` への組み込み位置

```js
const {
    // ...existing deps...
    fetchReferencedMessage = defaultFetchReferencedMessage  // ★追加
} = deps;

// addToThreadHistory の直前に挿入:
let replyContext = '';
if (message.reference?.messageId) {
    try {
        const refMsg = await fetchReferencedMessage(message);
        if (refMsg?.content) {
            replyContext = formatQuotedReference(refMsg);
        }
    } catch (err) {
        logger.warn('Failed to resolve referenced message', err, {
            threadId,
            referenceId: message.reference.messageId
        });
    }
}
const composedText = replyContext
    ? `${replyContext}\n${message.content}`
    : message.content;
```

その後、L54-57 と L61 の `message.content` を `composedText` に置換。

### 各ケースの扱い

| ケース | 扱い |
|---|---|
| `message.reference` が null/undefined | 何もしない（既存テスト互換） |
| 参照元が**bot 自身のメッセージ** | 通常どおり引用に含める（「この部分について詳しく」の対象は大半がメイドちゃんの回答なので重要） |
| 参照元が**ユーザーメッセージ** | 同様に引用。話者を区別する接頭辞付きで整形（下記形式） |
| 参照元が**削除済み**（fetch が throw） | warn ログを出して引用なしで続行。エラーにはしない |
| 参照元の `content` が空（embed のみ等） | 引用なしで続行 |
| 参照元が別チャンネルのメッセージ | スレッド内運用では基本発生しないが、fetch 成功するならそのまま引用して問題なし |

### プロンプト埋め込み形式（`messageUtils.js` にヘルパー追加）

```js
export const REFERENCE_QUOTE_MAX_LENGTH = 500;

export function formatQuotedReference(refMessage) {
    const speaker = refMessage.author?.bot ? 'アシスタント' : 'ユーザー';
    let text = refMessage.content || '';
    if (text.length > REFERENCE_QUOTE_MAX_LENGTH) {
        text = `${text.slice(0, REFERENCE_QUOTE_MAX_LENGTH)}…`;
    }
    return `（返信元の${speaker}メッセージ）\n> ${text.replaceAll('\n', '\n> ')}`;
}
```

- 500 文字で truncate（日本語概算で約 170 トークン相当、トークン膨張を防止）
- Discord 風の `>` 引用形式で LLM に「引用である」ことを明示
- 話者（bot/ユーザー）を明記して誰の発言か曖昧さを排除

### `defaultFetchReferencedMessage`

```js
async function defaultFetchReferencedMessage(message) {
    return await message.fetchReference();
}
```

テストからは deps 経由でモック注入可能。本番コードは discord.js の Message にのみ依存。

### 補足： `decideSearchPlan` への影響

`generateResponse` の第1引数（prompt）に引用文が混入するため、検索判定プロンプト（`decideSearchPlan`）にも引用が渡る。forceKeywords マッチや JSON 判定への影響は軽微と判断するが、気になる場合は prompt には生の `message.content` を渡し、引用入り `composedText` のみ履歴に保存する変形も可能。ただしその場合 LLM が今回のターンで引用を直接参照できなくなるため、**案A（両方に composedText）を推奨**。

## テスト計画

### 新規: `test/threadMessageHandler.reference.test.js`

既存テストが `reference` なしのモックで通ること（後方互換）をまず確認。新規テストケース:

1. **reference がない場合** — `fetchReferencedMessage` が呼ばれず、履歴・prompt が生の `message.content` のまま
2. **reference がある場合** — `fetchReferencedMessage` が呼ばれ、`generateResponse` の第1引数と `addToThreadHistory` の user エントリに引用が合成される（`assert.match` で `（返信元の` と `>` 引用を検証）
3. **参照元が bot メッセージの場合** — 「アシスタントメッセージ」という接頭辞で引用される
4. **参照元がユーザーメッセージの場合** — 「ユーザーメッセージ」という接頭辞で引用される
5. **fetchReference が throw（削除済み）** — 処理が継続し、応答が正常に返る。warn ログが出る
6. **参照元 content が空** — 引用なしで続行
7. **参照元が 500 文字超** — truncate され `…` が付く
8. **複数行の参照元** — 全行に `>` が付く
9. **assistant 応答の履歴追加は従来どおり** — 引用合成が assistant 側に漏れない

### `test/messageUtils.test.js` への追記

- `formatQuotedReference` の bot/ユーザー判定、truncate、複数行インデント、空 content の各単体テスト

### 実行確認

```bash
make test        # 全件パス
make lint-js     # Biome（--error-on-warnings 付きのため必須）
```

## 懸念点・注意事項

1. **トークン増加**: 引用が毎ターン履歴に蓄積するため、長いスレッドでは要約トリガー（12000 トークン）が早まる。truncate 500 字で緩和済みだが、`models.yml` の `num_ctx` との整合は要観察
2. **REST レート制限**: 返信のたびに `fetchReference()`（REST GET）が走る。頻度は低いが、将来キャッシュ（`threadManager` に messageId→content を保存等）を検討する余地あり。初回実装では不要
3. **シャローコピー**: `threadManager.cloneMessage` はシャローコピーだが、案Aでは文字列フィールドのみなので問題なし
4. **既存テスト互換**: 既存モックに `fetchReference` はないため、`message.reference` の存在チェックを必ず先に行うこと（optional chaining `message.reference?.messageId`）
5. **キューとの整合**: 参照解決は `processThreadMessage` 内＝スレッドキュー上で実行されるため、REST 遅延があっても順序は崩れない
6. **CI**: `npm run lint` は警告でも落ちるため、Biome のスタイル（シングルクォート・スペース 4・行幅 100）を遵守
