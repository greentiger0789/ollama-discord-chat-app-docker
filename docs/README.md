# 機能提案チケット一覧

Ollama Discord Bot（メイドちゃん）の機能拡張チケット。ユーザー目線で提案・優先度付けしたもの。

> **git 管理について**: 設計ドキュメントはバージョン管理して共有する価値があるため、現状は git 管理としています。管理外にしたい場合は `.gitignore` に `docs/` を追加してください。

## チケット一覧

| # | ファイル | 内容 | 工数感 |
|---|---------|------|--------|
| 1 | [ticket-01-conversation-management.md](ticket-01-conversation-management.md) | 会話のリセット・管理コマンド（`/o-reset` `/o-summary` スレッド名自動生成） | M |
| 2 | [ticket-02-abort-regenerate.md](ticket-02-abort-regenerate.md) | 応答の中断・再生成（❌ / 🔄 リアクション） | M |
| 3 | [ticket-03-mention-response.md](ticket-03-mention-response.md) | メンション対応（スレッド外ライトモード応答） | M |
| 4 | [ticket-04-text-attachment.md](ticket-04-text-attachment.md) | ファイル添付対応（テキストファイルのみ） | M |
| 5 | [ticket-05-reply-context.md](ticket-05-reply-context.md) | 返信メッセージへの文脈追加 | M |
| 6 | [ticket-06-multi-user.md](ticket-06-multi-user.md) | 複数人での会話対応 | M |

## 推奨実装順序

1. **チケット1** — 最小工数で最大効果。`clearThreadHistory` が既存のため容易
2. **チケット5** — ollamaClient 無変更で完結。単独 PR 化しやすい
3. **チケット3** — メンション対応。チケット6 の履歴拡張と親和性あり
4. **チケット6** — 履歴形式拡張（`speaker` 追加）。チケット3・5 と履歴スキーマを共有するため早めに確定推奨
5. **チケット4** — 添付対応。トークン設計の検討が必要
6. **チケット2** — AbortController の伝播が広範囲のため最後に実装し、十分なテスト保護のもとで行う

## 共通の注意事項

- 実装後は必ず `make lint-js`（Biome `--error-on-warnings` 付き）と `make test` を通すこと
- 新規プロンプトはコードにハードコードせず `config/prompts.yml` へ外部化
- ロガーは `src/logger.js` の `createLogger(scope)` を使用
- テストは `node:test` + DI モック注入パターン（モジュール状態を持つ対象は fresh import）
