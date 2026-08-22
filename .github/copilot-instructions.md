# Copilot Instructions

Ollama をバックエンドにした Discord ボット（「メイドちゃん」キャラクター）を Docker Compose で運用するプロジェクトです。

## プロジェクト構成

- **ルート**: Docker Compose オーケストレーション（`ollama` / `open-webui` / `discord-bot` の 3 サービス）
- **`discord-bot/`**: Node.js (ESM, `"type": "module"`) 製の Discord ボット本体。依存は `discord.js` v14、`node-fetch`、`js-yaml`、`@tavily/core`
- **主要モジュール** (`discord-bot/src/`):
  - `index.js`: エントリーポイント。Client 初期化とハンドラ登録
  - `ollamaClient.js`: Ollama API 通信・検索判定・履歴要約・モデル設定読み込み
  - `threadManager.js`: スレッド単位の会話履歴管理
  - `prompts.js` / `systemPrompt.js` / `decisionPrompt.js`: プロンプト管理
  - `commands/oCommand.js`: `/o` スラッシュコマンド
  - `handlers/threadMessageHandler.js`: スレッド内フォローアップ処理
- **設定ファイル** (`discord-bot/config/`): `models.yml`（モデル別パラメータ）、`prompts.yml`。コード変更時はこれらの YAML も確認すること

## よく使うコマンド

Makefile を推奨（ホスト側で実行）。ボットコンテナ内では自動的に JS 関連ターゲットのみに切り替わる。

```bash
make up            # コンテナ起動（バックグラウンド）
make dev           # 開発モード（ログ付き）
make down          # コンテナ停止
make test          # テスト実行（新規コンテナ）
make test-quick    # テスト実行（起動済みコンテナ）
make lint          # 全 lint（JS + Actions + Dockerfile）
make lint-js       # Biome lint のみ
make lint-security # Gitleaks / Trivy / npm audit
```

直接実行する場合:

```bash
docker compose run --build --rm --no-deps discord-bot npm test
docker compose exec discord-bot npm test   # 起動済みコンテナで手早く
docker compose run --build --rm --no-deps discord-bot npm run lint
```

## コーディング規約

- **フォーマッタ/リンタ: Biome** (`discord-bot/biome.json`)
  - インデント: スペース 4、行幅 100
  - シングルクォート、セミコロンあり、末尾カンマなし、アロー関数の括弧は省略 (`asNeeded`)
  - `npm run lint` は `--error-on-warnings` 付き。警告でも CI が落ちるため、編集後は必ず `npm run lint`（または `make lint-js`）で検証
- **ESM のみ**: `import`/`export` 構文を使用。CommonJS は禁止
- **Node.js 組み込みモジュール優先**: 外部依存を追加する前に `node:` 標準モジュールで実現できないか検討
- **ロガー**: `console.log` ではなく `src/logger.js` の `createLogger(scope)` を使用（`LOG_LEVEL` 対応、テスト環境では自動的に warn 以上に抑制される）
- **設定の外部化**: モデルパラメータやプロンプトはコードにハードコードせず `config/models.yml` / `config/prompts.yml` を経由

## テスト

- **テストランナー: Node.js 組み込み `node:test`**（Jest/Mocha は不使用）。`assert/strict` を使用
- テストファイルは `discord-bot/test/*.test.js`
- `npm test` は `LOG_LEVEL=silent node --test` で実行される
- モジュール状態を持つ対象（例: `threadManager.js`）は、テスト内でクエリパラメータ付き動的 import により毎回 fresh import するパターンを採用 — 既存テストのパターンに倣うこと
- 新機能追加時は対応するテストファイルを作成/更新し、`make test` で全件パスを確認

## アーキテクチャ上の注意点

- **Docker 開発フローが基本**: `discord-bot/` は bind mount され、`dev-runner.js` が `index.js`, `src/`, `config/`, `.env` の変更を監視してホットリロードする。`package.json` 変更時はコンテナ内で自動 `npm ci` される
- **`.env` はコミット禁止**（トークン等を含む）。テンプレートは `.env.example`。Gitleaks CI でシークレットスキャンが走る
- **Ollama 接続 URL**: コンテナ内からは `http://ollama:11434`（サービス名解決）。ホストからは `http://localhost:11434`
- **GPU 前提**: ollama サービスは NVIDIA GPU デバイス要求あり。GPU 無し環境では `deploy.resources` の調整が必要な点に注意
- **Discord 制限**: 応答は 1900 文字で自動分割送信（`messageUtils.js`）。この上限を変更する場合は Discord API 制限 (2000 文字) を考慮
- **トークン概算**: 日本語 LLM 向けの概算ロジックと履歴要約（最大 12000 トークン）が `ollamaClient.js` にある。コンテキスト長関連の変更は `models.yml` の `num_ctx` との整合を保つこと

## CI/CD

- `ci.yml`: Node.js 26 で `npm ci` → `npm run lint` → `npm test`、加えて actionlint / hadolint / Docker ビルドチェック
- `gitleaks.yml`: シークレットスキャン
- `trivy.yml`: 脆弱性スキャン（HIGH/CRITICAL）
- PR 作成前には `make lint` と `make test` を通しておくこと

## 言語

README・コメント・プロンプト・コミュニケーションは日本語ベース。コード内コメントも既存スタイルに合わせて日本語で記述する。
