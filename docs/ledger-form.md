# LedgerForm（2ファイル元帳突合）設計

## 目的
- 支店A/Bの元帳（各1ファイル）を用い、当該2拠点間の本支店勘定を日別で照合する。

## 画面仕様（UI）
- 配置: `TbForm` の直下。カードUIを共通化。
- 入力:
  - `対象期間`: `<input type="month">` 初期値=当月
  - `支店A`: `<select>`（`constants/masterdata/master-data.ts` の `BRANCHES`）
  - `支店Aの元帳`: `<input type="file" accept=".xlsx">`
  - `支店B`: `<select>`
  - `支店Bの元帳`: `<input type="file" accept=".xlsx">`
- 操作: 「照合を実行」→ サーバーアクションを起動し、出力XLSXを即時ダウンロード。
- エラーハンドリング: 上部にメッセージ表示。`reset` で消去。

## サーバーアクション
- ファイル: `app/actions/ledger-reconcile.ts`
- 関数: `ledgerReconcileAction(form: FormData)`
- 入力: `period, branchA, branchB, ledgerA(File), ledgerB(File)`
- 仕様:
  - 先頭シートのみ対象。列は `LEDGER_HEADER` の列番号で参照。
  - 科目は `11652090` のみ。
  - 相手先支店の決定順序（DRY/KISS）
    1) `resolveBranchCodeBySubaccount(subCode)`（静的表）
    2) `resolveCounterpartyCodeFromSubName(subName)`（支店名エイリアス＋先頭一致）
  - 片側ファイルにつき「相手支店向き」の行のみ抽出。
  - 日別に金額（借方-貸方）を配列で保持し、`sumA`,`sumB`,`diff` を算出。

## 出力
- 形式: XLSX（ExcelJS）。
- シート `by_day`:
  - ヘッダ: `date, A1..An, B1..Bm, sumA, sumB, diff`
  - 行: 期間内日付を全行生成（存在しない日は空欄）。
- シート `info`: `period, branchA(name,code), branchB(name,code)`

## 実装ファイル
- `components/ledger/ledger-form.tsx`
- `app/actions/ledger-reconcile.ts`
- `lib/counterparty.ts`（補助科目名→支店コード解決の共通化）

## 受入テスト（チェックリスト）
- [ ] 期間 `2025-03` で31行が出力される（2月は28/29行）。
- [ ] 支店A/Bを入れ替えると `A*`/`B*` 列が入れ替わる。
- [ ] 両ファイルに同額反対仕訳のみがある日は `diff=0`。
- [ ] 一方にのみ仕訳がある日は `diff≠0` となる。
- [ ] `info` シートに選択支店名/コードが正しく記録される。

## 原則の適用
- KISS: 2ファイル・1ペアに限定した最小UI、CSVは後回し。
- DRY: 相手先解決ロジックを `lib/counterparty.ts` に共通化。
- YAGNI: 許容誤差・月跨ぎ除外・複数ファイル/複数ペア同時処理は未実装。

