FROM node:26-alpine

ARG PNPM_VERSION=10.34.5
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# 最新のセキュリティ修正を取り込むため、make のバージョンは固定しない
# hadolint ignore=DL3018
RUN apk upgrade --no-cache \
    && apk add --no-cache make

# 最新の pnpm をインストールし、pnpm 内部の脆弱パッケージを修正版で上書き
# （不要な同梱 npm は削除して脆弱性混入を防止）
# 対象: tar CVE-2026-73566 / ip-address CVE-2026-69192 / brace-expansion CVE-2026-14257, CVE-2026-69152, CVE-2026-102276, CVE-2026-102278
WORKDIR /tmp
RUN npm install --global "pnpm@${PNPM_VERSION}" \
    && npm pack ip-address@10.3.1 brace-expansion@5.0.11 tar@7.5.22 \
    && PNPM_MODULES=/usr/local/lib/node_modules/pnpm/dist/node_modules \
    && for pkg in ip-address brace-expansion tar; do \
        rm -rf "${PNPM_MODULES:?}/$pkg" \
        && mkdir -p "$PNPM_MODULES/$pkg" \
        && tar xzf "$pkg"*.tgz -C "$PNPM_MODULES/$pkg" --strip-components=1; \
    done \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /tmp/*.tgz

WORKDIR /app

# pnpm の設定と lockfile を含めてコピーし、依存関係の再現性と Docker キャッシュを両立
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# lockfile に固定された依存関係をインストール
RUN pnpm install --frozen-lockfile

# アプリ本体コピー
COPY . .

CMD ["node", "index.ts"]
