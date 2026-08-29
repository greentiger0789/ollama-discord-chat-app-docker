日本語 | [English](README.en.md)

# Discord Ollama Bot

Ollama をバックエンドに使用した Discord ボットです。「メイドちゃん」キャラクターによる質問応答、Web 検索、スレッド単位の会話履歴管理が可能です。

## 特徴

- **Ollama 連携**: ローカル LLM（NVIDIA GPU 対応）およびクラウドモデルを活用
- **Slash Command**: `/o` コマンドで質問するとスレッドを作成して応答
- **会話履歴管理**: スレッド単位で履歴を保持し、長くなると自動要約
- **応答の中断・再生成**: 応答中または直近の応答に ❌ / 🔄 を付けて、実行者が中断・再生成可能
- **複数人会話**: 複数の参加者を区別し、最新の発言者を優先して応答
- **Web 検索**: Tavily（失敗時 DuckDuckGo にフォールバック）でリアルタイム検索
- **ホットリロード開発**: ソース・設定・`.env` の変更を自動検出して再起動
- **Open WebUI**: オプションで Web UI を追加可能

## 前提条件

- Docker / Docker Compose v2 以上
- NVIDIA GPU（コンテナ側で自動設定。GPU 無し環境は `docker-compose.yml` の `deploy.resources` 調整が必要）
- Discord Bot Token（[Discord Developer Portal](https://discord.com/developers/applications) で作成）
- Web 検索を使う場合: [Tavily](https://tavily.com/) の API Key

ランタイム: Node.js v26 以上（直接実行する場合のみ）

## クイックスタート

### 1. 環境変数の設定

```bash
cp .env.example .env
```

`.env` を編集して `DISCORD_TOKEN` などを設定します。

### 2. 起動

```bash
make up
```

### 3. 動作確認

Discord で `/o` コマンドを実行し、Bot がスレッドを作成して応答すれば成功です。

## 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `DISCORD_TOKEN` | ✅ | Discord Bot のトークン |
| `DISCORD_GUILD_ID` | ❌ | コマンドを登録するサーバー ID（未指定時はグローバルコマンド） |
| `OLLAMA_HOST` | ❌ | Ollama サーバー自身の待ち受け URL（デフォルト: `http://0.0.0.0:11434`） |
| `OLLAMA_BASE_URL` | ❌ | Bot から見た Ollama サーバーの URL（デフォルト: `http://ollama:11434`） |
| `OLLAMA_MODEL` | ❌ | 使用するモデル名（デフォルト: `qwen3.5:9b`） |
| `OLLAMA_AUTO_LOAD` | ❌ | `true` で起動時にモデルを自動プル・ウォームアップ（クラウドモデルはウォームアップをスキップ） |
| `TAVILY_API_KEY` | ❌ | Web 検索用 API Key |
| `LOG_LEVEL` | ❌ | `debug` / `info` / `warn` / `error` / `silent`（デフォルト: `info`） |
| `COMPOSE_PROFILES` | ❌ | `webui` で Open WebUI を有効化 |

## 使い方

### `/o` コマンド

- `prompt`（必須）にプロンプトを送信すると、スレッドを作成して応答
- `file`（任意）にテキストファイルを添付すると、内容を踏まえて回答（512KB・20,000文字まで）
- スレッド内のメッセージにも文脈を引き継いで返信
- フォローアップへ返信するのは `/o` が作成したスレッドだけです。通常のスレッドには返信しません
- 他の通常メンバーを直接メンションした投稿や、そのメンバーの投稿への返信には応答せず、会話履歴にも追加しません。「返信先に通知」の設定にかかわらず、メイドちゃんと他のメンバーの両方が宛先の場合も同様です
- 「考え中…」および直近の応答には ❌（中断）と 🔄（再生成）が付き、`/o` を実行した本人またはスレッド内で発言した本人が操作可能
- 長文応答は 1900 文字単位で自動分割送信

添付はテキスト、コード、ログなどに対応します。画像・動画・音声・PDF・圧縮ファイルなどは
読み込めません。スレッド内で複数ファイルを添付した場合は先頭の1件のみを読み込みます。
トークン、パスワード、`.env` などの機密情報は添付しないでください。

複数人が発言するスレッドでは、会話の文脈を区別するため、参加者の Discord 表示名を Ollama への入力に含めます。ユーザー ID は送信しません。

### Open WebUI

`.env` に `COMPOSE_PROFILES=webui` を設定して `make up` すると、`http://localhost:3000` で Web UI が利用できます。

## 設定ファイル

### `discord-bot/config/models.yml`

モデルごとのパラメータ（`num_ctx`, `num_predict`, `temperature`, `mirostat`, `repeat_penalty` など）を定義します。ボットはここからモデル設定を読み込みます。

```yaml
models:
  qwen3.5:9b:
    num_ctx: 16384
    num_predict: 8192
    temperature: 0.3
```

### `discord-bot/config/prompts.yml`

システムプロンプト（メイドちゃんのキャラクター設定）や Web 検索時の通知文言を定義します。

## 開発・テスト・Lint

Makefile を推奨（ホスト側で実行）。ボットコンテナ内では自動的に TypeScript 関連ターゲットのみに切り替わります。

```bash
# 起動・停止
make up            # コンテナ起動（バックグラウンド）
make dev           # 開発モード（ログ付き）
make down          # コンテナ停止
make down-v        # ボリュームも含めて停止
make shell         # discord-bot コンテナに入る

# テスト
make test          # 新規コンテナで実行
make test-quick    # 起動済みコンテナで実行（手早い）

# Lint
make lint          # Biome・型検査・Actions・Dockerfile lint
make lint-js       # Biome lint のみ
make typecheck     # TypeScript 型検査
make lint-actions  # actionlint のみ
make lint-docker   # hadolint のみ

# セキュリティスキャン
make lint-security # 全スキャン実行
make scan-secrets  # Gitleaks
make scan-vulns    # Trivy
make scan-code     # npm audit
```

直接実行する場合:

```bash
docker compose run --build --rm --no-deps discord-bot npm test
docker compose exec discord-bot npm test   # 起動済みコンテナで手早く
docker compose run --build --rm --no-deps discord-bot npm run lint
docker compose run --build --rm --no-deps discord-bot npm run typecheck
```

ホスト上で直接 Node.js 実行する場合:

```bash
cd discord-bot
npm ci
npm run dev    # ホットリロード付き
npm start      # 通常実行
```

## アーキテクチャ

```
Discord ──> discord-bot ──> ollama (LLM 推論)
                │
                └──> Tavily / DuckDuckGo (Web 検索)
```

応答生成の流れ:

1. **トークン概算**: 入力テキストから概算トークン数を計算（日本語 LLM 向け）
2. **履歴要約**: 履歴が長すぎる場合は要約してコンテキストを節約（最大 12000 トークン）
3. **検索判定**: Web 検索が必要かどうかをプロンプトで判定
4. **応答生成**: 検索結果を含めて LLM に送信
5. **応答分割**: Discord 上限 (1900 文字) に合わせて分割送信

主要モジュール (`discord-bot/src/`):

| モジュール | 役割 |
|-----------|------|
| `index.ts` | エントリーポイント。Client 初期化とハンドラ登録 |
| `ollamaClient.ts` | Ollama API 通信・検索判定・履歴要約・モデル設定読み込み |
| `threadManager.ts` | スレッド単位の会話履歴管理 |
| `messageUtils.ts` | メッセージ分割送信・「思考中」メッセージ生成 |
| `prompts.ts` / `systemPrompt.ts` / `decisionPrompt.ts` | プロンプト管理 |
| `commands/oCommand.ts` | `/o` スラッシュコマンド |
| `handlers/threadMessageHandler.ts` | スレッド内フォローアップ処理 |

## ディレクトリ構成

```
.
├── docker-compose.yml           # サービスオーケストレーション
├── Dockerfile                   # Ollama サーバー用
├── ollama-entrypoint.sh         # Ollama 起動・モデルプル・ウォームアップ
├── Makefile                     # 開発・lint・テスト用コマンド
├── .env.example                 # 環境変数テンプレート
├── .github/workflows/           # ci.yml / gitleaks.yml / trivy.yml
└── discord-bot/                 # Discord Bot 本体
    ├── index.ts                 # エントリーポイント
    ├── dev-runner.ts            # 開発用ホットリロードランナー
    ├── biome.json               # Biome 設定
    ├── tsconfig.json            # TypeScript 型検査設定
    ├── config/
    │   ├── models.yml           # モデル別パラメータ
    │   └── prompts.yml          # プロンプト設定
    ├── src/                     # ソースコード
    └── test/                    # テスト (node:test)
```

## CI/CD

`.github/workflows/` に以下を設定しています。

- **`ci.yml`**: Node.js 26 で `npm ci` → `npm run lint` → `npm run typecheck` → `npm test`。加えて actionlint / hadolint / Docker ビルドチェック
- **`gitleaks.yml`**: シークレットスキャン（検知結果を PR にコメント）
- **`trivy.yml`**: イメージ・ファイルシステムの脆弱性スキャン（HIGH/CRITICAL、結果は GitHub Security タブへ）

PR 作成前には `make lint` と `make test` を通しておくこと（`make lint` は型検査も含みます）。

## トラブルシューティング

| 症状 | 確認ポイント |
|------|-------------|
| Bot が応答しない | `DISCORD_TOKEN`、Bot の権限（Send Messages / Read Message History / Add Reactions / Embed Links / Manage Threads）、Ollama サーバーの起動状態 |
| Ollama に接続できない | `OLLAMA_BASE_URL`、コンテナ間ネットワーク、`docker compose logs ollama` のヘルスチェック |
| Web 検索が機能しない | `TAVILY_API_KEY`、API レート制限 |

## 参考リンク

- [discord.js ドキュメント](https://discord.js.org/)
- [Ollama 公式](https://github.com/ollama/ollama)
- [Tavily API](https://tavily.com/)
- [Docker Compose 公式ドキュメント](https://docs.docker.com/compose/)

---

Contributions welcome! 🎉 issues や PR をお気軽に送ってください。
