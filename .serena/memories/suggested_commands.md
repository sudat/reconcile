# 推奨コマンド

## 開発サーバー起動
```bash
# 推奨（Bun使用）
bun run dev

# 代替（npm使用）
npm run dev
```
開発サーバーは http://localhost:3000 で起動

## データベース関連
```bash
# Prismaクライアント生成
bunx prisma generate
# または
bun run prisma:generate

# マイグレーション実行
bunx prisma migrate dev --name <migration_name>
# または
bun run prisma:migrate

# データベースリセット
bunx prisma migrate reset -f
# または
bun run prisma:reset
```

## データ処理
```bash
# Balance Detail データ抽出（サンプル）
bun run extract:balance
# パラメータ例：
# --file=docs/balance-detail/SS総勘定元帳_テストデータ.xlsx
# --dept=2100000000 --subject=21701
# --out=app/balance-detail/sample-data.json
```

## ビルド・品質チェック
```bash
# 本番ビルド
bun run build

# リント実行
bun run lint
# または
bunx eslint

# 開発サーバー停止（ポートが使用中の場合）
# ポート3000のプロセスを確認・停止
lsof -ti:3000 | xargs kill -9
```

## パッケージ管理
```bash
# パッケージインストール
bun install

# パッケージ追加
bun add <package-name>

# 開発依存関係追加
bun add -d <package-name>
```

## 環境変数設定
`.env`ファイルに以下を設定：
- `DATABASE_URL` - PostgreSQL接続URL
- `OPENAI_API_KEY` - OpenAI API キー（AI機能使用時）