// 共通: 補助科目名から相手先支店コードを推定（フォールバック）
// 目的: サブ科目コード→支店コードが未定義のケースを、支店名エイリアスで先頭一致解決（KISS/DRY）
import { BRANCHES } from "@/constants/masterdata/master-data";
import { BRANCH_ALIAS_TO_CODE, canonicalBranchCode } from "@/constants/masterdata/aliases";

/**
 * 補助科目名（例: "神戸店本支店取引"）等から支店コードを解決する。
 * - エイリアス辞書/正式支店名の長い順で先頭一致
 * - 見つかったコードは canonicalBranchCode() で正規化
 */
export function resolveCounterpartyCodeFromSubName(subName: string): string | null {
  const n = String(subName ?? "").trim();
  if (!n) return null;
  const aliasNames = Object.keys(BRANCH_ALIAS_TO_CODE);
  const candidates = Array.from(new Set([...aliasNames, ...BRANCHES.map((b) => b.name)])).sort(
    (a, b) => b.length - a.length
  );
  for (const name of candidates) {
    if (n.startsWith(name)) {
      const code = BRANCH_ALIAS_TO_CODE[name] ?? BRANCHES.find((b) => b.name === name)?.code;
      if (code) return canonicalBranchCode(code);
    }
  }
  return null;
}

