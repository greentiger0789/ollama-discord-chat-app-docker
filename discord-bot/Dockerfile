FROM node:26-alpine

WORKDIR /app

# 最新のセキュリティ修正を取り込むため、make のバージョンは固定しない
# hadolint ignore=DL3018
RUN apk upgrade --no-cache \
    && apk add --no-cache make

# 同梱 npm を最新化し、npm 内部の脆弱パッケージを修正版で上書き
# （npm@latest だけでは内部依存は更新されないため、修正版を手動で展開する）
# 対象: tar CVE-2026-73566 / ip-address CVE-2026-69192 / brace-expansion CVE-2026-14257, CVE-2026-69152
WORKDIR /tmp
RUN npm install --global npm@latest \
    && npm pack ip-address@10.3.1 brace-expansion@5.0.9 tar@7.5.22 \
    && NPM_MODULES=/usr/local/lib/node_modules/npm/node_modules \
    && for pkg in ip-address brace-expansion tar; do \
        rm -rf "${NPM_MODULES:?}/$pkg" \
        && mkdir -p "$NPM_MODULES/$pkg" \
        && tar xzf "$pkg"*.tgz -C "$NPM_MODULES/$pkg" --strip-components=1; \
    done \
    && rm -f /tmp/*.tgz

WORKDIR /app

# package-lock.json を含めてコピーし、依存関係の再現性と Docker キャッシュを両立
COPY package*.json ./

# lock ファイルに固定された依存関係をインストール
RUN npm ci

# アプリ本体コピー
COPY . .

CMD ["node", "index.ts"]
