# 照合アーキテクチャ（PRD準拠）

本書は本支店勘定の照合実装の設計を示す。実装は Next.js のサーバーアクションへ一本化し、`services/reconcile.ts` は削除した（KISS / DRY / YAGNI）。

## 実装構成（サーバーアクション）

- `app/actions/tb-reconcile.ts`
  - 関数: `tbReconcileAction(form: FormData)`
  - 役割: 試算表（TB）に基づくペアごとの期末残高突合（A→B と B→A の和 = 0 を一致条件）。
  - 入力: `period(YYYY-MM)`, `tb(File)`, `aggregateBranches(ON/OFF)`
  - 出力: JSON（UI表示用の結果配列）。
  - 主要仕様:
    - `TB_HEADER` の列番号で読み取り、科目 `11652090` のみ対象。
    - 相手先支店の解決は `resolveBranchCodeBySubaccount()` を優先し、なければ補助科目名から推定。
    - 支店集約オプションで神戸エリア等を正規化。

- `app/actions/ledger-reconcile.ts`
  - 関数: `ledgerReconcileAction(form: FormData)`
  - 役割: 支店A/Bの元帳2ファイルを日別で突合し、XLSX を返却。
  - 入力: `period(YYYY-MM)`, `branchA`, `ledgerA(File)`, `branchB`, `ledgerB(File)`
  - 出力: `xlsx`（base64, `by_day`/`info` シート）。
  - 主要仕様:
    - `LEDGER_HEADER` の列番号で読み取り、科目 `11652090` のみ対象。
    - 金額は `借方入力金額+借方入力税額` と `貸方入力金額+貸方入力税額` から `signed = 借方-貸方` を算出。
    - それぞれのファイルから「相手支店向き」の行のみ抽出し、日別に `sumA`,`sumB`,`diff` を計算。

## 入出力仕様のポイント
- 先頭シート固定。列はヘッダ名ではなく `TB_HEADER` / `LEDGER_HEADER` の列番号で参照（重複列名対策）。
- 支店コード/科目コードは文字列で保持（先頭ゼロ維持、trim しない）。
- `drcr_code` は `0/1` を採用。

## 改訂履歴
- 2025-09-03: UI基準を追加。既定フォントを `Noto Sans JP`、既定ウェイトを `font-normal(400)` に統一。主要UIコンポーネント（Button/Label/Table/CardTitle）のデフォルトも `font-normal` 化。
- 2025-09-03: サーバーアクションへ一本化。`services/reconcile.ts` を削除し、UI 直結の I/O（File 入力・base64 出力）に統一。
