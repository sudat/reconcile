# システム構成・アーキテクチャ

## システム全体構成

### フロントエンド（Next.js App Router）
```
app/
├── page.tsx                 # ホームページ
├── layout.tsx              # 全体レイアウト
├── reconcile/              # 照合機能（TB/GL）
├── balance-detail/         # 残高詳細管理
├── actions/               # Server Actions
└── api/                   # API Routes (AI機能等)
```

### データモデル（Prisma）
**reconcileスキーマ内の主要テーブル：**
- `Dataset` - 部門・科目・年月単位のデータセット
- `Entry` - 各勘定項目エントリ
- `Project` - グループ化されたプロジェクト
- `ProjectEntry` - プロジェクトとエントリの紐付け
- `ImportJob` - ファイルインポート管理

## 主要機能の構成

### 1. テナント切替
- **場所**: サイドバーフッター
- **実装**: `components/common/nav-user.tsx`
- **状態管理**: コンポーネント内ローカル状態（永続化なし）

### 2. 照合システム（/reconcile）
- **TB（試算表）**: `components/tb/tb-form.tsx`
- **GL（元帳A/B）**: `components/ledger/ledger-form.tsx`  
- **UI**: タブ切替（`components/balance-detail/tab-row.tsx`再利用）

### 3. Balance Detail（/balance-detail）
- **インポート**: ExcelJSによるファイル処理
- **AI分析**: OpenAI連携（`/api/ai/ledger-unmatch`）
- **プロジェクト管理**: 案件の自動グループ化

## データフロー

### ファイルアップロード → AI分析
1. Excel形式の総勘定元帳をアップロード
2. `uploadAndGroupAllAction` でデータ抽出・DB保存
3. AI自動グループ化実行
4. アンマッチ検出時にOpenAI分析実行
5. 結果をブラウザに表示

### 監視・ログ
- **ターミナルログ**: `instrumentation.ts`でConsole出力をファイルミラー
- **Prismaログ**: DB処理ログを`lib/prisma.ts`で記録
- **ワークフローログ**: `lib/logger.ts`で処理単位のログ管理
- **OpenAI Traces**: 処理の可視化（ダッシュボード連携）

## レスポンシブ設計
- **xl以上**: サイドバー表示（`variant: inset`）
- **lg以下**: サイドバー非表示（モバイル用ドロワーなし）
- **最大幅**: `max-w-7xl`で統一

## セキュリティ・パフォーマンス
- **環境変数**: `DATABASE_URL`, `OPENAI_API_KEY`
- **バッチ処理**: 部門×科目単位での並列実行
- **一括取得**: 月度単位でのデータ取得最適化
- **進捗表示**: 1秒間隔ポーリングによるリアルタイム更新