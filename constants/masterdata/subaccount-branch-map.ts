// 目的: 勘定科目（SubAccounts）と支店（BRANCHES）の対応一覧を提供する
// 方針: ユーザ指定に合わせ、ロジックではなく静的JSONを正とする（KISS/DRY）

export type SUBACCOUNT_BRANCH_LINK = {
  subAccountName: string;
  subAccount: string; // サブ科目コード（補助科目コード）
  branchName: string | null;
  branchCode: string | null;
};

// 静的テーブル（生成元: constants/masterdata/subaccount-branch-map.json）
import table from "./subaccount-branch-map.json" assert { type: "json" };

export const SUBACCOUNT_BRANCH_MAP: SUBACCOUNT_BRANCH_LINK[] =
  table as SUBACCOUNT_BRANCH_LINK[];

// 逆引き: サブ科目コード → 支店コード
export const SUBACCOUNT_CODE_TO_BRANCH_CODE: Record<
  string,
  string | undefined
> = Object.fromEntries(
  // null は未定義扱いに正規化して型整合を取る（KISS）
  SUBACCOUNT_BRANCH_MAP.map((x) => [x.subAccount, x.branchCode ?? undefined])
);

// 利便関数: サブ科目名/コードから支店コードを解決
export function resolveBranchCodeBySubaccount(
  subAccount: string | { name: string; subAccount: string }
): string | undefined {
  if (typeof subAccount === "string")
    return SUBACCOUNT_CODE_TO_BRANCH_CODE[subAccount] ?? undefined;
  return SUBACCOUNT_CODE_TO_BRANCH_CODE[subAccount.subAccount] ?? undefined;
}

import { applyKobeGrouping } from "./aliases";
export function resolveBranchCodeBySubaccountWithKobeGrouping(
  subAccount: string | { name: string; subAccount: string }
): string | undefined {
  const base = resolveBranchCodeBySubaccount(subAccount);
  return base ? applyKobeGrouping(base) : undefined;
}
