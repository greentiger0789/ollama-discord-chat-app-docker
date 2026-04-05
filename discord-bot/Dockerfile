FROM node:25-slim

WORKDIR /app

# package-lock.json を含めてコピーし、依存関係の再現性と Docker キャッシュを両立
COPY package*.json ./

# lock ファイルに固定された依存関係をインストール
RUN npm ci

# アプリ本体コピー
COPY . .

CMD ["node", "index.js"]
