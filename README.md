# Discord Ollama Bot

Ollama をバックエンドに使用した Discord ボットです。質問応答、Web検索、会話履歴の管理、そして「メイドちゃん」キャラクターによる独創的な応答が可能です。


---

## 📋 目次

- [特徴](#特徴)
- [前提条件](#前提条件)
- [クイックスタート](#クイックスタート)
- [ディレクトリ構成](#ディレクトリ構成)
- [環境変数](#環境変数)
- [設定](#設定)
- [実行方法](#実行方法)
  - [Docker Compose で実行](#docker-compose-で実行)
  - [直接 Node.js で実行](#直接-nodejs-で実行)
- [スラッシュコマンド](#スラッシュコマンド)
- [機能詳細](#機能詳細)
  - [会話履歴管理](#会話履歴管理)
  - [Web検索機能](#web検索機能)
  - [応答生成戦略](#応答生成戦略)
  - [モデル設定](#モデル設定)
- [テスト](#テスト)
- [CI/CD](#cicd)
- [プロジェクト構成](#プロジェクト構成)
- [Ollama サーバー設定](#ollama-サーバー設定)
- [トラブルシューティング](#トラブルシューティング)
- [参考リンク](#参考リンク)
- [バージョン履歴](#バージョン履歴)

---

## 特徴

- 🔹 **Ollama 連携**: `ollama/ollama` との連携で、独自のLLMモデルを活用
- 🔹 **Discord Slash Command**: `/o` コマンドで簡単質問応答
- 🔹 **会話履歴管理**: スレッド単位での会話履歴を自動管理・要約
- 🔹 **Web検索統合**: Tavily / DuckDuckGo を使ったリアルタイム検索
- 🔹 **キャラクター設定**: 「メイドちゃん」としての独創的応答
- 🔹 **応答分割送信**: 長文応答を自動的に分割して送信
- 🔹 **モデル設定ファイル**: YAML形式でモデルごとのパラメータを設定可能
- 🔹 **GPU対応**: NVIDIA GPU を活用した高速推論
- 🔹 **Open WebUI**: オプションでWeb UIを利用可能
- 🔹 **コンテナ化**: Docker Compose で簡単デプロイ

---

## 前提条件

以下がインストールされていることを確認してください：

- **Docker** （推奨: 最新版）
- **Docker Compose** （v2 以上推奨）
- **Node.js** （v24以上、直接実行する場合）
- **Discord Bot Token** ([Discord Developer Portal](https://discord.com/developers/applications)で作成)
- **Ollama サーバー** (`http://localhost:11434` または別ホスト)
- **Tavily API Key** （Web検索機能を使用する場合、[Tavily API](https://tavily.com/)で取得）

---

## クイックスタート

### 1. 環境変数の設定

`.env` ファイルをプロジェクトルートに作成し、以下の内容を記述します：

```env
# Discord
DISCORD_TOKEN=your_discord_bot_token
DISCORD_GUILD_ID=your_server_id (オプション)

# Ollama
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=qwen3.5:9b

# Tavily (オプション)
TAVILY_API_KEY=your_tavily_api_key
```

> **参考**: `.env.example` ファイルの内容を参考にしてください。

### 2. コンテナを起動

```bash
docker compose up -d
```

### 3. Bot を Discord で確認

- Discord を開き、`/o` コマンドを実行
- メッセージを入力すると、Bot が応答します

---

## ディレクトリ構成

```
.
├── README.md                    # このファイル
├── docker-compose.yml           # Docker Compose 設定
├── Dockerfile                   # Ollama サーバー用 Dockerfile
├── ollama-entrypoint.sh        # Ollama 起動スクリプト
├── .env                         # 環境変数（Git では無視）
├── .env.example                 # 環境変数のテンプレート
├── .gitignore                   # Git 無視設定
├── .github/
│   └── workflows/
│       └── ci.yml               # CI/CD パイプライン設定
├── discord-bot/                 # Discord Bot ディレクトリ
│   ├── index.js                 # メインスクリプト
│   ├── package.json             # Node.js 依存関係
│   ├── .dockerignore            # Docker ignore 設定
│   ├── Dockerfile               # Bot 用 Dockerfile
│   ├── config/
│   │   └── models.yml           # モデル設定ファイル
│   ├── logs/                    # ログ出力ディレクトリ
│   ├── src/
│   │   ├── discordClient.js     # Discord クライアント初期化
│   │   ├── ollamaClient.js      # Ollama クライアント
│   │   ├── systemPrompt.js      # システムプロンプト
│   │   ├── decisionPrompt.js    # 検索判定プロンプト
│   │   ├── messageUtils.js      # メッセージユーティリティ
│   │   ├── threadManager.js     # スレッド履歴管理
│   │   ├── commands/
│   │   │   └── oCommand.js      # /o コマンドハンドラ
│   │   └── handlers/
│   │       └── threadMessageHandler.js  # スレッドメッセージハンドラ
│   └── test/
│       ├── decisionPrompt.test.js
│       ├── discordClient.test.js
│       ├── messageUtils.test.js
│       ├── oCommand.test.js
│       ├── ollamaClient.comprehensive.test.js
│       ├── ollamaClient.test.js
│       ├── systemPrompt.test.js
│       ├── threadManager.test.js
│       └── threadMessageHandler.test.js
└── ollama-data/                 # Ollama データ永続化用
    ├── config.json
    ├── history
    ├── id_ed25519
    ├── id_ed25519.pub
    ├── server.json
    └── models/
        ├── blobs/
        └── manifests/
```

---

## 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `DISCORD_TOKEN` | ✅ | Discord Bot のトークン |
| `DISCORD_GUILD_ID` | ❌ | コマンドを登録するサーバーID（指定しない場合はグローバルコマンド） |
| `OLLAMA_HOST` | ❌ | Ollama サーバーのホスト (デフォルト: `http://0.0.0.0:11434`) |
| `OLLAMA_BASE_URL` | ❌ | Botから見たOllamaサーバーのURL (デフォルト: `http://ollama:11434`) |
| `OLLAMA_MODEL` | ❌ | 使用するモデル名 (デフォルト: `qwen3.5:9b`) |
| `OLLAMA_AUTO_LOAD` | ❌ | 起動時にモデルを自動ロードするか (デフォルト: `false`) |
| `OLLAMA_API_KEY` | ❌ | Ollama API キー（クラウドモデル用） |
| `TAVILY_API_KEY` | ❌ | Web検索機能に使用するAPIキー |
| `COMPOSE_PROFILES` | ❌ | Docker Compose プロファイル (例: `webui`) |

---

## 設定

### Discord Bot の設定

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセス
2. 新しいアプリケーションを作成
3. Bot を追加し、トークンをコピー
4. Bot の権限設定で以下の権限を付与：
   - `Send Messages`
   - `Read Message History`
   - `Embed Links`
   - `Manage Threads`
5. サーバーに Bot を招待

### Ollama サーバーの設定

`docker-compose.yml` で Ollama を起動する設定が含まれています。以下のモデルを自動でロードする設定となっています：

- `qwen3.5:9b` （デフォルト）

---

## 実行方法

### Docker Compose で実行

```bash
# 環境変数ファイルを作成
cp .env.example .env
# .env を編集して環境変数を設定

# 起動
docker compose up -d
```

### 直接 Node.js で実行

```bash
# 依存関係のインストール
cd discord-bot
npm install

# 実行
npm start
```

---

## スラッシュコマンド

### `/o` コマンド

- **説明**: Ollama にプロンプトを送信
- **引数**:
  - `prompt` (必須): 送信するプロンプト
- **応答**:
  - スレッドを作成し、応答を返信
  - 長文の場合は自動的に分割して送信

---

## 機能詳細

### 会話履歴管理

- スレッドごとに会話履歴を保持
- 履歴が長くなると自動で要約
- 最大コンテキスト長を考慮した履歴管理

### Web検索機能

- 質問内容に応じて、Tavily または DuckDuckGo を使用
- 検索が必要なキーワード（例: 「最新」「今日」「価格」など）を自動判定
- 検索結果を元に回答を生成

### 応答生成戦略

1. **トークン概算**: 入力テキストの長さから概算トークン数を計算（日本語LLM向け）
2. **履歴要約**: 履歴が長すぎると、要約してコンテキストを節約（最大12000トークン）
3. **検索判定**: Web検索が必要かどうかを判定（強制キーワード含む）
4. **応答生成**: 検索結果を含めた状態でLLMにプロンプトを送信
5. **応答分割**: 長文の場合は Discord の上限 (1900文字) に合わせて分割

### モデル設定

`discord-bot/config/models.yml` でモデルごとのパラメータを設定できます：

```yaml
models:
  qwen3.5:9b:
    num_ctx: 16384
    num_predict: 8192
    temperature: 0.3

  qwen3:14b:
    num_ctx: 16384
    num_predict: 8192
    temperature: 0.3

  qwen3.5:cloud:
    num_ctx: 131072
    num_predict: 4096
    num_keep: 2048
    temperature: 0.4
    mirostat: 2
    mirostat_tau: 5
    mirostat_eta: 0.1
    repeat_penalty: 1.1
```

設定可能なパラメータ：
- `num_ctx`: コンテキストウィンドウサイズ
- `num_predict`: 生成する最大トークン数
- `temperature`: 生成のランダム性（0-1）
- `mirostat`: 適応的サンプリング方式
- `repeat_penalty`: 繰り返しペナルティ

---

## テスト

```bash
# プロジェクトルートで実行（ホスト側から）
docker compose run --build --rm --no-deps discord-bot npm test
```

起動済みの `discord-bot` コンテナに対して手早く再実行したい場合は、以下でも実行できます。

```bash
docker compose exec discord-bot npm test
```

テストカバレッジ：
- `decisionPrompt.test.js` - 検索判定プロンプト
- `discordClient.test.js` - Discord クライアント
- `messageUtils.test.js` - メッセージユーティリティ
- `oCommand.test.js` - /o コマンドハンドラ
- `ollamaClient.test.js` - Ollama クライアント基本
- `ollamaClient.comprehensive.test.js` - Ollama クライアント包括テスト
- `systemPrompt.test.js` - システムプロンプト
- `threadManager.test.js` - スレッド管理
- `threadMessageHandler.test.js` - スレッドメッセージハンドラ

---

## CI/CD

`.github/workflows/ci.yml` で CI/CD パイプラインが設定されています。

- **トリガー**: `main` および `develop` ブランチへのプッシュ、PR
- **テスト実行**: `npm test` コマンド

---

## プロジェクト構成

### Discord Bot (`discord-bot/`)

- **`index.js`**: メインスクリプト。Discord Client の初期化とイベントハンドラの登録
- **`src/discordClient.js`**: Discord Client の設定とスラッシュコマンド登録
- **`src/ollamaClient.js`**: Ollama との通信を担当。検索判定、履歴要約、モデル設定読み込みを含む
- **`src/systemPrompt.js`**: メイドちゃんキャラクター設定のシステムプロンプト
- **`src/decisionPrompt.js`**: Web検索が必要かどうかを判定するプロンプト
- **`src/messageUtils.js`**: メッセージ分割送信と「思考中」メッセージ生成
- **`src/threadManager.js`**: スレッドごとの会話履歴管理
- **`src/commands/oCommand.js`**: `/o` スラッシュコマンドのハンドラ
- **`src/handlers/threadMessageHandler.js`**: スレッド内のフォローアップメッセージ処理
- **`config/models.yml`**: モデルごとのパラメータ設定ファイル

### Ollama サーバー

- **`Dockerfile`**: Ollama サーバー用のカスタムDockerfile（curlインストール含む）
- **`ollama-entrypoint.sh`**: サーバー起動、モデルプル、ウォームアップを行うスクリプト

---

## Ollama サーバー設定

`docker-compose.yml` で以下の設定が含まれています：

### サービス構成

- **ollama**: メインのOllamaサーバー（ポート11434）
  - NVIDIA GPU対応（自動検出）
  - ヘルスチェック機能
  - 自動モデルロード機能

- **open-webui**: Web UI（オプション、ポート3000）
  - `COMPOSE_PROFILES=webui` で有効化
  - Ollamaサーバーのヘルスチェック後に起動

- **discord-bot**: Discord Bot（discord-botサービス）

### GPU サポート

NVIDIA GPUを使用する場合、`docker-compose.yml` で自動的に設定されます：

```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: all
          capabilities: [ gpu ]
```

### 自動モデルロード

`OLLAMA_AUTO_LOAD=true` を設定すると、起動時に指定したモデルを自動的にプル・ウォームアップします。
クラウドモデル（`:cloud`サフィックス）の場合はウォームアップをスキップします。

---

## トラブルシューティング

### Bot が応答しない

- `DISCORD_TOKEN` が正しいか確認
- Bot の権限が適切に設定されているか確認
  - `Send Messages`
  - `Read Message History`
  - `Embed Links`
  - `Manage Threads`
- Ollama サーバーが起動しているか確認

### Ollama サーバーに接続できない

- `OLLAMA_BASE_URL` が正しいか確認
- コンテナ間のネットワーク設定を確認
- ヘルスチェックが通っているか確認: `docker compose logs ollama`

### Web検索が機能しない

- `TAVILY_API_KEY` が正しいか確認
- API の制限を超えていないか確認

### テストが失敗する

- ホスト側から実行する場合は `docker compose run --build --rm --no-deps discord-bot npm test` を使用
- 起動済みコンテナで再実行する場合は `docker compose exec discord-bot npm test` を使用
- コンテナ内で直接実行する場合は Node.js v24以上を使用し、`npm install` を実行して依存関係をインストール

## 依存関係

### 本体依存関係

| パッケージ | バージョン | 用途 |
|-----------|-----------|------|
| `discord.js` | ^14.25.1 | Discord API クライアント |
| `@discordjs/rest` | ^2.6.0 | Discord REST API |
| `discord-api-types` | ^0.38.40 | Discord API 型定義 |
| `node-fetch` | ^3.3.2 | HTTP クライアント |
| `dotenv` | ^16.4.7 | 環境変数管理 |
| `@tavily/core` | ^0.7.2 | Tavily 検索 API |
| `js-yaml` | ^4.1.1 | YAML パーサー |

### ランタイム

- **Node.js**: v24以上
- **pnpm**: パッケージマネージャ（Docker内で使用）

---

## 参考リンク

- [Discord.js ドキュメント](https://discord.js.org/)
- [Ollama 公式ドキュメント](https://github.com/ollama/ollama)
- [Tavily API](https://tavily.com/)
- [Docker Compose 公式ドキュメント](https://docs.docker.com/compose/)

---


**Contributions welcome!** 🎉
issues や PR をお気軽に送ってください。
