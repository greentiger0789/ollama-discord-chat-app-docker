FROM node:24-slim

# pnpm を使えるようにする
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# package.json のみコピーして Docker キャッシュ活用
COPY package.json ./

# lock ファイルなしでインストール
RUN pnpm install --no-frozen-lockfile

# アプリ本体コピー
COPY . .

CMD ["node", "index.js"]
