"use server";
import ExcelJS from "exceljs";
import { TB_HEADER } from "@/constants/reports/report-header";
import { BRANCHES } from "@/constants/masterdata/master-data";
import {
  normalizeBranchForPairing,
  KOBE_GROUP_AGGREGATE_CODE,
} from "@/constants/masterdata/aliases";
import { resolveBranchCodeBySubaccount } from "@/constants/masterdata/subaccount-branch-map";
import { resolveCounterpartyCodeFromSubName } from "@/lib/counterparty";

type TBRow = {
  branchCode: string;
  branchName: string;
  accountCode: string;
  accountName: string;
  subCode: string;
  subName: string;
  sideCode: string; // 0/1
  openAmount: number;
  debitGross: number;
  creditGross: number;
  endAmount: number;
};

function num(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function findCol(name: string) {
  const def = TB_HEADER.find((h) => h.name === name);
  return def?.column ?? null;
}

const BRANCH_NAME_BY_CODE = new Map(BRANCHES.map((b) => [b.code, b.name]));

// resolveCounterpartyCodeFromSubName は lib/counterparty.ts に共通化（DRY）

export type TBPairResult = {
  leftBranch: string;
  rightBranch: string;
  leftAmount: number;
  rightAmount: number;
  diff: number;
};

// useActionState 用に prevState を第1引数で受け取れるようにする
export async function tbReconcileAction(_prevState: unknown, form: FormData) {
  const file = form.get("tb") as File | null;
  const period = String(form.get("period") || ""); // YYYY-MM（今は表示のみ）
  // UI側の名称ぶれ対策（DRY）: aggregateBranches / aggregatePayments の両方を受ける
  const aggregateFlagRaw = String(
    form.get("aggregateBranches") ?? form.get("aggregatePayments") ?? "on"
  );
  const useKobeGrouping = aggregateFlagRaw === "on" || aggregateFlagRaw === "true" || aggregateFlagRaw === "1";
  if (!file) return { ok: false as const, error: "試算表ファイルが未指定です" };

  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { ok: false as const, error: "シートが見つかりません" };

  const col = {
    branchCode: findCol("対象組織コード")!,
    branchName: findCol("対象組織名")!,
    accountCode: findCol("勘定科目コード")!,
    accountName: findCol("勘定科目名")!,
    subCode: findCol("補助科目コード")!,
    subName: findCol("補助科目名")!,
    sideCode: findCol("科目貸借区分")!,
    openAmount: findCol("期間前基準金額")!,
    debitGross: findCol("期間内借方基準金額")!,
    creditGross: findCol("期間内貸方基準金額")!,
    endAmount: findCol("累計基準金額")!,
  };

  for (const [k, v] of Object.entries(col)) {
    if (!v || typeof v !== "number") {
      return { ok: false as const, error: `必要列が見つかりません: ${k}` };
    }
  }

  const rows: TBRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const tb: TBRow = {
      branchCode: normalizeBranchForPairing(text(row.getCell(col.branchCode).value), { kobeGrouping: useKobeGrouping }),
      branchName: text(row.getCell(col.branchName).value),
      accountCode: text(row.getCell(col.accountCode).value),
      accountName: text(row.getCell(col.accountName).value),
      subCode: text(row.getCell(col.subCode).value),
      subName: text(row.getCell(col.subName).value),
      sideCode: text(row.getCell(col.sideCode).value),
      openAmount: num(row.getCell(col.openAmount).value),
      debitGross: num(row.getCell(col.debitGross).value),
      creditGross: num(row.getCell(col.creditGross).value),
      endAmount: num(row.getCell(col.endAmount).value),
    };
    if (!tb.branchCode || !tb.accountCode) continue;
    // 科目フィルタ: 11652090 のみ
    if (tb.accountCode !== "11652090") continue;
    rows.push(tb);
  }

  // A->B と B->A を突合するため、pairキーを方向付きで保持
  const pairSum = new Map<string, number>();
  const pairKey = (a: string, b: string) => `${a}|${b}`;

  for (const r of rows) {
    // 1st: 静的マップ（サブ科目コード→支店コード）で厳密に解決（KISS/DRY）
    const counter =
      resolveBranchCodeBySubaccount(r.subCode) ??
      // 2nd: 後方互換として名称先頭一致にもフォールバック
      resolveCounterpartyCodeFromSubName(r.subName) ??
      null;
    if (!counter) continue; // 相手先が特定できない行はスキップ（将来: レポート）
    const right = normalizeBranchForPairing(counter, { kobeGrouping: useKobeGrouping });
    const left = r.branchCode; // 取込時に正規化済み
    if (left === right) continue; // 同一支店同士（合算後を含む）は除外
    const key = pairKey(left, right);
    pairSum.set(key, (pairSum.get(key) ?? 0) + r.endAmount);
  }

  // 総当たり: BRANCHES定義の支店コード（正規化後で重複排除）から全組み合わせを作る
  const orderedCodesRaw = BRANCHES.map((b) => normalizeBranchForPairing(b.code, { kobeGrouping: useKobeGrouping }));
  const codes: string[] = [];
  for (const c0 of orderedCodesRaw) {
    const c = c0; // すでに normalize 済み
    if (!codes.includes(c)) codes.push(c);
  }

  const out: TBPairResult[] = [];
  for (let i = 0; i < codes.length; i++) {
    for (let j = i + 1; j < codes.length; j++) {
      const L = codes[i];
      const R = codes[j];
      const ab = pairSum.get(pairKey(L, R)) ?? 0;
      const ba = pairSum.get(pairKey(R, L)) ?? 0;
      out.push({
        leftBranch: L,
        rightBranch: R,
        leftAmount: ab,
        rightAmount: ba,
        diff: ab + ba,
      });
    }
  }

  // ブランチ名を付与して返す（クライアントで表示に利用）
  const withNames = out.map((r) => ({
    ...r,
    leftBranchName:
      BRANCH_NAME_BY_CODE.get(r.leftBranch) ??
      (r.leftBranch === KOBE_GROUP_AGGREGATE_CODE ? "神戸合計" : r.leftBranch),
    rightBranchName:
      BRANCH_NAME_BY_CODE.get(r.rightBranch) ??
      (r.rightBranch === KOBE_GROUP_AGGREGATE_CODE ? "神戸合計" : r.rightBranch),
    period,
  }));

  return { ok: true as const, results: withNames };
}
