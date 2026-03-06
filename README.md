# ollama-docker

ローカルに永続化されたデータ（モデル、鍵、履歴など）を使って Ollama を Docker Compose で起動するシンプルなセットアップです。
Open WebUI との連携対応済み。

---

## 📋 目次

- [前提条件](#前提条件)
- [クイックスタート](#クイックスタート)
- [ディレクトリ構成](#ディレクトリ構成)
- [機能](#機能)
  - [データ永続化](#データ永続化)
  - [Open WebUI 連携](#open-webui-連携)
  - [GPU サポート](#gpu-サポート)
- [詳細セットアップ](#詳細セットアップ)
  - [NVIDIA Container Toolkit（WSL2/Ubuntu）](#nvidia-container-toolkitwsl2ubuntu)
- [セキュリティ注意](#セキュリティ注意)
- [トラブルシューティング / FAQ](#トラブルシューティング--faq)
- [参考リンク](#参考リンク)

---

## 前提条件

以下がインストールされていることを確認してください：

- **Docker** （推奨: 最新版）
- **Docker Compose** （v2 以上推奨）
- **NVIDIA GPU** （オプション：GPU を使用する場合）
- **NVIDIA Container Toolkit** （WSL2/Ubuntu + GPU の場合、後述の手順で導入）

---

## クイックスタート

### 1. コンテナをバックグラウンドで起動

```bash
docker compose up -d
```

### 2. Ollama コンテナで対話的にアクセス

```bash
docker exec -it ollama bash
```

### 3. モデルを実行

```bash
ollama run qwen3.5:9b
ollama run qwen3:14b
ollama run freehuntx/qwen3-coder:14b
```

> **注**: 上記は例です。利用可能なモデルは環境やインストール状況に依存します。公式 Ollama リポジトリで利用可能なモデルを確認してください。

### 4. Open WebUI にブラウザでアクセス

ブラウザで以下にアクセスしてください：

```
http://localhost:3000
```

---

## ディレクトリ構成

```
.
├── docker-compose.yml     # Docker Compose サービス定義
├── Dockerfile             # コンテナイメージ定義
├── README.md              # このファイル
├── .gitignore             # Git 無視設定
└── ollama-data/           # 永続ストレージ（ホスト側）
    ├── history/           # CLI 履歴
    ├── id_ed25519         # SSH 秘密鍵 ⚠️ (Git 追跡対象外)
    ├── id_ed25519.pub     # SSH 公開鍵
    └── models/            # ダウンロード済みモデル
        ├── blobs/         # モデルブロビング
        └── manifests/     # モデルマニフェスト
```

---

## 機能

### データ永続化

`ollama-data/` をホストボリュームとしてマウントしています。

**利点:**

- コンテナ再作成後も、モデル・履歴・設定データが失われない
- バックアップが容易
- ホスト側からのアクセス・管理が可能

> **パーミッション注意**: ボリューム内のファイルのオーナーがコンテナ内の UID と異なる場合、パーミッションエラーが発生することがあります。必要に応じて `sudo chown -R` で修正してください。

---

### Open WebUI 連携

`docker-compose.yml` に `open-webui` サービスを含めています。

**起動方法:**

```bash
docker compose up -d
```

両方のサービスが起動します：

- **Ollama**: `http://localhost:11434`
- **Open WebUI**: `http://localhost:3000`

**アーキテクチャ:**

Open WebUI は `OLLAMA_BASE_URL=http://host.docker.internal:11434` で Ollama に接続します。
Linux 環境では `extra_hosts: ["host.docker.internal:host-gateway"]` を設定して対応しています。

**トラブル時:**

`host.docker.internal` が解決しない場合、`docker-compose.yml` の `OLLAMA_BASE_URL` をホスト IP に置き換えてください：

```yaml
OLLAMA_BASE_URL: http://192.168.x.x:11434
```

---

### GPU サポート

`docker-compose.yml` の Ollama サービスに GPU アクセス設定を含めています（`deploy.resources` セクション）。

**動作するには:**

- ホスト側に NVIDIA GPU が搭載されていること
- NVIDIA Container Toolkit をインストール済みであること（後述）

GPU が検出されない場合は、NVIDIA Container Toolkit の導入手順を参照してください。

---

## 詳細セットアップ

### NVIDIA Container Toolkit（WSL2/Ubuntu）

WSL2 上で GPU を利用する場合は、NVIDIA Container Toolkit を導入する必要があります。

#### ステップ 1: リポジトリ設定と GPG キー追加

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg && \
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
```

#### ステップ 2: ツールキットをインストール

```bash
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
```

#### ステップ 3: Docker に NVIDIA ランタイムを設定

```bash
sudo nvidia-ctk runtime configure --runtime=docker
```

#### ステップ 4: Docker デーモンを再起動

```bash
sudo service docker restart
```

検証:

```bash
docker run --rm --gpus all nvidia/cuda:11.8.0-runtime-ubuntu22.04 nvidia-smi
```

上記で GPU 情報が表示されれば成功です。

---

## セキュリティ注意

⚠️ **重要な注意： このリポジトリに SSH 秘密鍵（`ollama-data/id_ed25519`）が含まれています**

**公開リポジトリで使用する場合の手順:**

1. リポジトリをクローン後、新しい鍵を生成：

```bash
ssh-keygen -t ed25519 -f ollama-data/id_ed25519 -N ""
```

2. 既存の鍵がコミットされている場合は、Git 履歴から削除：

```bash
git rm --cached ollama-data/id_ed25519 ollama-data/id_ed25519.pub
git commit -m "Remove sensitive keys from history"
git push
```

3. リモートサービスで旧鍵をマイグレーション / 無効化します

---

## トラブルシューティング / FAQ

### Q1: Open WebUI が Ollama に接続できない

**原因:** `host.docker.internal` が Linux で解決していない可能性、またはファイアウォール設定

**対策:**

1. ホスト IP を確認:

```bash
hostname -I
```

2. `docker-compose.yml` の `OLLAMA_BASE_URL` をホスト IP に置き換え：

```yaml
environment:
  OLLAMA_BASE_URL: http://<ホストIP>:11434
```

3. コンテナを再起動：

```bash
docker compose down
docker compose up -d
```

---

### Q2: GPU が Docker コンテナで認識されない

**原因:** NVIDIA Container Toolkit が未導入、または Docker デーモン設定が不完全

**対策:**

1. NVIDIA Container Toolkit が導入されているか確認：

```bash
which nvidia-ctk
```

2. 未導入の場合は、前述の「NVIDIA Container Toolkit（WSL2/Ubuntu）」セクションに従ってインストール

3. Docker が NVIDIA ランタイムを使用するか確認：

```bash
docker info | grep nvidia
```

---

### Q3: Ollama モデルをローカルディレクトリに保存したい

**説明:** デフォルトで `ollama-data/` ディレクトリ（ボリューム）に保存されています。

**確認方法:**

```bash
docker exec -it ollama bash
# コンテナ内で
ls -la /root/.ollama/models
```

ホスト側では `./ollama-data/models/` として見えます。バックアップが必要な場合はこのディレクトリをコピーしてください。

---

### Q4: Dockerfile をカスタマイズしたい

**説明:** リポジトリの `Dockerfile` を編集することで、ベースイメージやインストール済みツールをカスタマイズできます。

修正後、イメージを再ビルド：

```bash
docker compose build
docker compose up -d
```

---

### Q5: Ollama のマニュアル操作（REPL）

Ollama のインタラクティブシェル（REPL）にアクセス：

```bash
docker exec -it ollama ollama list
```

モデルの詳細情報や操作は Ollama の公式ドキュメント参照。

---

## 参考リンク

- [Ollama 公式ドキュメント](https://github.com/ollama/ollama)
- [Open WebUI リポジトリ](https://github.com/open-webui/open-webui)
- [NVIDIA Container Toolkit GitHub リポジトリ（インストール手順含む）](https://github.com/NVIDIA/nvidia-container-toolkit)
- [Docker Compose 公式ドキュメント](https://docs.docker.com/compose/)

---

**最後更新:** 2026年2月18日

コントリビューションや改善提案は、お気軽にイシューやPRでお知らせください。
