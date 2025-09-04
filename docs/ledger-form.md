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
- 実行中のフィードバック（2025-09-04 追加）
  - 実行ボタン内にスピナー（`Loader2`）を表示。
  - 実行ボタン下にリアルタイムログを表示（クライアント計測）。
    - 例: `[1/4] アップロード中 → [2/4] サーバ照合中 → [3/4] 結果作成中 → [4/4] ダウンロード開始`。
    - エラー時は当該行に `エラー:` を追記。
  - アンマッチ発生時はAI分析をバックグラウンドで開始し、ログ下に「AI分析」ボックスを表示。
    - ローディング: 「AI分析中…」
    - 完了時: 箇条書きサマリ（概要/主要ズレ/原因仮説/次の確認）
- エラーハンドリング: 上部にメッセージ表示。`reset` で消去。

## サーバーアクション
- ファイル: `app/actions/ledger-reconcile.ts`
- 関数: `ledgerReconcileAction(form: FormData)`
- 入力: `period, branchA, branchB, ledgerAUrl(string), ledgerBUrl(string)`
  - 後方互換として `ledgerA(File), ledgerB(File)` も受容するが、既定はBlob URL方式。
- 仕様:
- 先頭シートのみ対象。列は `LEDGER_HEADER` の列番号で参照。
- 科目は `11652090` のみ。
- 計上日セルは文字列(`yyyymmdd`)/Excel日付どちらでも受付。実装側で `yyyymmdd` に正規化（KISS）。
  - 相手先支店の決定順序（DRY/KISS）
    1) `resolveBranchCodeBySubaccount(subCode)`（静的表）
    2) `resolveCounterpartyCodeFromSubName(subName)`（支店名エイリアス＋先頭一致）
  - 片側ファイルにつき「相手支店向き」の行のみ抽出。
  - 日別に金額（借方-貸方）を配列で保持し、`sumA`,`sumB`,`diff` を算出。

## 出力
- 形式: XLSX（ExcelJS）。
- シート `by_day`:
  - ヘッダ: `date, Sub:A_<sub>..., Sub:B_<sub>..., sumA, sumB, diff`
  - 各 `Sub:A_<sub>` / `Sub:B_<sub>` は該当補助科目コードの当日合計（借方-貸方）。
  - 採用する `<sub>` は相手支店向けの補助科目コードのみ（静的マスタに基づき昇順）。
  - 行: 期間内日付を全行生成（存在しない日は空欄）。
- シート `info`: `period, branchA(name,code), branchB(name,code)`
- アンマッチありの場合、別ファイル `ledger-unmatch_YYYY-MM_A-B.xlsx` を追加返却。
  - シート `unmatched`
  - ヘッダ: 左に `A:` + `LEDGER_HEADER` 全列、右に `B:` + 同列。
  - 行: Aのアンマッチ行（左のみ）→Bのアンマッチ行（右のみ）の順に全件。
- 判定: `(借方+借方税)-(貸方+貸方税)` の符号込みで一致し、AとBの合計が0となるペアを相殺（除外）。

## AI要約 API
- ルート: `POST /api/ai/ledger-unmatch`
- 入力: `ledgerReconcileAction` が返す `analysis` オブジェクト（期間、支店コード、`daySummary`、`itemsA/B`）
- 出力: `{ ok: true, summary: string }` または `{ ok: false, error: string }`
- 備考: 入力が大きい場合はサーバ側でサンプリングしてトークン最適化（KISS）。

## 実装ファイル
- `components/ledger/ledger-form.tsx`
- `app/actions/ledger-reconcile.ts`
- `app/api/blob/upload/route.ts`（Vercel Blobのクライアント直送トークン）

## アップロード方式の変更（2025-09-04）

- 目的: Vercelのボディ上限により発生するHTTP 413を回避するため、元帳ファイルはクライアントからVercel Blobへ直接アップロードする。
- フロー:
  1) クライアントで `@vercel/blob/client` の `upload()` を呼び、`/api/blob/upload` で発行されたトークンを用いて直接Blobへ送る（`multipart: true`）。
  2) 返却された `url` を `ledgerAUrl` / `ledgerBUrl` としてServer Actionへ渡す。
  3) Server ActionはBlob URLを `fetch()` し、ExcelJSで処理して結果XLSXを返す。

セキュリティ注意: Vercel Blobの `access` は現状 `public` を使用。公開URLの取り扱いに留意し、保管期間・自動削除の運用は別途検討する。
- `lib/counterparty.ts`（補助科目名→支店コード解決の共通化）

## 受入テスト（チェックリスト）
- [ ] 期間 `2025-03` で31行が出力される（2月は28/29行）。
- [ ] 支店A/Bを入れ替えると `A*`/`B*` 列が入れ替わる。
- [ ] 両ファイルに同額反対仕訳のみがある日は `diff=0`。
- [ ] 一方にのみ仕訳がある日は `diff≠0` となる。
- [ ] `info` シートに選択支店名/コードが正しく記録される。
- [ ] `diff≠0` 日が1つでもある場合、アンマッチファイルが同時にダウンロードされる。
- [ ] アンマッチファイルの行順が「ヘッダ→A側→B側」になっている。
- [ ] 同額（絶対値）ペアはアンマッチに含まれない。
 - [ ] アンマッチ発生時、AIのローディングとサマリが表示される。

## 原則の適用
- KISS: 2ファイル・1ペアに限定した最小UI、CSVは後回し。
- DRY: 相手先解決ロジックを `lib/counterparty.ts` に共通化。
- YAGNI: 許容誤差・月跨ぎ除外・複数ファイル/複数ペア同時処理は未実装。
