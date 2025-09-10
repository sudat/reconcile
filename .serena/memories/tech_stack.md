# 技術スタック

## フロントエンド
- **React** 19.1.0
- **Next.js** 15.5.2 (App Router)
- **TypeScript** ^5
- **Tailwind CSS** ^4 with `@tailwindcss/postcss`
- **shadcn/ui** - UIコンポーネント（Radix UI ベース）
- **Lucide React** - アイコン
- **next-themes** - ダークモード対応
- **Sonner** - トースト通知

## バックエンド・データベース
- **Prisma** ^6.15.0 - ORM
- **PostgreSQL** - データベース（`reconcile`スキーマ使用）
- **Server Actions** - Next.jsのサーバーサイド処理

## AI・外部サービス
- **OpenAI** ^5.19.1 - AI分析機能
- **@openai/agents** ^0.1.1 - OpenAIエージェント機能
- **Vercel Blob** - ファイルストレージ

## データ処理
- **ExcelJS** ^4.4.0 - Excelファイル処理
- **Zod** 3 - スキーマ検証

## 開発ツール
- **Bun** - パッケージマネージャー・ランタイム（推奨）
- **ESLint** ^9 - Next.js/TypeScript設定
- **PostCSS** - CSS処理

## インフラ・監視
- Console/Prismaログのファイル出力機能
- OpenAI Traces連携による処理可視化