# 勘定科目（SubAccounts）と支店（BRANCHES）の対応一覧設計

## 目的
- 入力明細の補助科目（サブ科目）から、会計上の支店コードを機械的に導出する。

## 対応ファイル
- 正: `constants/masterdata/subaccount-branch-map.json`（静的対応表）
- 利用: `constants/masterdata/subaccount-branch-map.ts`（JSONを読み込み、逆引きを提供）

## 方針（KISS/DRY）
- ロジックによる推定は行わず、`subaccount-branch-map.json` を一次ソース（正）とする。
- TypeScript は同 JSON を読み込み、逆引き辞書のみ生成（重複定義を避ける）。
- 実装反映: `app/actions/tb-reconcile.ts` は `resolveBranchCodeBySubaccount()` を優先し、
  後方互換フォールバックは「支店名の表記ゆれ」エイリアス `BRANCH_ALIAS_TO_CODE` を使った先頭一致のみ。
  （補助科目名の別名辞書 `SUBACCOUNT_NAME_ALIASES` は廃止）

## 生成物
- `SUBACCOUNT_BRANCH_MAP: { subAccountName, subAccount, branchName|null, branchCode|null }[]`
- `SUBACCOUNT_CODE_TO_BRANCH_CODE: Record<string, string|undefined>`（JSON 中の `branchCode: null` は実装で `undefined` に正規化して格納）
- `resolveBranchCodeBySubaccount()` 補助関数
- `aliases.ts`:
  - `canonicalBranchCode()` … 同一視コードの正規化（例: 本社調整→本社）
  - `normalizeBranchForPairing(code, { kobeGrouping })` … ペア集計用の最終正規化。内部で `canonicalBranchCode()` を適用し、`kobeGrouping` が `true` の場合に神戸合算を適用（既定: `true`）。

## 既知の未解決ケース
- `不動産*`, `セグメント間消去*` は現時点で `branchCode: null` として明示。
  - 集約先が決まれば JSON を直接更新する。

## 受入テスト（チェックリスト）
- [ ] `心斎橋店本支店取引` → `050000101`
- [ ] `東京店回金` → `050000201`
- [ ] `京都店買掛金立替決済` → `050000301`
- [ ] `神戸店給与立替決済` → `050000401`（`純神戸` 同義）
- [ ] `梅田店賞与立替決済` → `050000601`
- [ ] `札幌店回金` → `050000701`
- [ ] `名古屋店本支店取引` → `050001001`
- [ ] `上野店買掛金立替決済` → `050001101`
- [ ] `静岡店給与立替決済` → `050001201`
- [ ] `高槻店回金` → `050001401`
- [ ] `法人外商本支店取引` → `050001601`
- [ ] `下関店本支店取引` → `050005301`
- [ ] `本社回金` → `050004001`
- [ ] `須磨本支店取引` → `050000402`（`須磨店` として解決）
- [ ] `芦屋本支店取引` → `050000403`（`芦屋店` として解決）
- [ ] `デパコ本支店取引` → `050004001`（エイリアスで本社へ）
- [ ] `本社調整本支店取引` → `050004001`（エイリアスで本社へ）

### 画面確認（TB照合）
- [ ] 対象組織: 心斎橋店を選択し、ペア「心斎橋店→須磨店」「心斎橋店→芦屋店」の A→B 期末残高が 0 円にならない（B→A と相殺方向で値が入る）。

## 運用
- 新たな支店表記が出た場合は `aliases.ts` の `BRANCH_ALIAS_TO_CODE` に別名を追加（DRY）。
  本ファイル（JSON/逆引き）のロジック変更は不要（YAGNI）。

## 変更履歴
- 2025-09-03: `branchCode: null` を `undefined` に正規化する実装へ修正（TypeScript の `Record<string, string|undefined>` に適合）。

## 画面設定（トグル）
- フォームの「支店集約」トグル（既定: ON）で、神戸合算の適用を切替。
- サーバーアクションに `aggregateBranches`（"on"/"off"）として渡し、正規化で使用。
