# コードスタイル・規約

## TypeScript設定
- **Target**: ES2017
- **Strict mode**: 有効
- **Path alias**: `@/*` で プロジェクトルート参照
- **JSX**: preserve（Next.js処理）

## ESLint設定
- Next.js Core Web Vitals
- Next.js TypeScript推奨設定
- 除外: `node_modules`, `.next`, `out`, `build`, `next-env.d.ts`

## ファイル命名規則
- **コンポーネント**: kebab-case（例: `nav-user.tsx`, `tab-row.tsx`）
- **ページ**: Next.js App Router規約（`page.tsx`, `layout.tsx`）
- **サーバーアクション**: kebab-case（例: `balance-get-all.ts`）
- **ユーティリティ**: kebab-case

## ディレクトリ構造
```
app/
├── actions/          # Server Actions
├── api/             # API Routes
├── balance-detail/  # 機能別ページ
└── reconcile/       # 機能別ページ
components/
├── ui/              # shadcn/ui基本コンポーネント
├── common/          # 共通コンポーネント
├── balance-detail/  # 機能別コンポーネント
└── reconcile/       # 機能別コンポーネント
```

## コンポーネント規約
- **shadcn/ui**: Radix UI + Tailwind CSS
- **レスポンシブ**: `xl`以上でサイドバー表示、それ以下で非表示
- **アクセシビリティ**: ARIA属性の適切な使用
- **i18n**: 日本語ラベル使用

## データベース規約
- **スキーマ**: `reconcile`（小文字）
- **ID**: UUID使用（`@default(uuid())`）
- **タイムスタンプ**: `createdAt`, `updatedAt`
- **論理削除**: `softDeletedAt`, `isDeleted`
- **インデックス**: 検索・結合用に適切に設定

## ログ規約
- **形式**: `[YYYY-MM-DDTHH:mm:ss.sssZ][xxxxxxxx...] メッセージ`
- **言語**: 日本語（例: `Excel受信開始: 月度=YYYY-MM`）
- **出力先**: `log/terminal.log`（グローバル）、`log/<workflowId>_terminal.log`（ワークフロー別）