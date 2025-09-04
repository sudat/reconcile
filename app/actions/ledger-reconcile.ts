"use server";
import ExcelJS from "exceljs";
import { LEDGER_HEADER } from "@/constants/reports/report-header";
import { BRANCHES } from "@/constants/masterdata/master-data";
import { canonicalBranchCode } from "@/constants/masterdata/aliases";
import { resolveBranchCodeBySubaccount } from "@/constants/masterdata/subaccount-branch-map";
import { resolveCounterpartyCodeFromSubName } from "@/lib/counterparty";

const INTERBRANCH_ACCOUNT_CODE = "11652090";

type DayKey = string; // yyyymmdd

function toNumber(x: unknown): number {
  if (x === null || typeof x === "undefined" || x === "") return 0;
  const n = typeof x === "number" ? x : Number(String(x).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function asText(x: unknown): string {
  // 元データのゼロ埋めを保持
  return String(x ?? "");
}

function monthDays(periodYYYYMM: string): string[] {
  const [y, m] = periodYYYYMM.split("-").map((s) => Number(s));
  if (!y || !m) return [];
  const dt = new Date(y, m - 1, 1);
  const out: string[] = [];
  while (dt.getMonth() === m - 1) {
    const ymd = `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, "0")}${String(dt.getDate()).padStart(2, "0")}`;
    out.push(ymd);
    dt.setDate(dt.getDate() + 1);
  }
  return out;
}

function isInPeriod(date8: string, periodYYYYMM: string) {
  return date8.startsWith(periodYYYYMM.replace("-", ""));
}

async function parseLedgerFromBuffer(
  buf: ArrayBuffer,
  opts: { period: string; selfBranch: string; counterBranch: string }
) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("シートが見つかりません");

  const col = {
    branchCode: LEDGER_HEADER.find((h) => h.name === "対象組織コード")!.column,
    branchName: LEDGER_HEADER.find((h) => h.name === "対象組織名")!.column,
    accountCode: LEDGER_HEADER.filter((h) => h.name === "勘定科目コード").find((h) => h.column === 86)!.column,
    subAccountCode: LEDGER_HEADER.find((h) => h.name === "補助科目コード")!.column,
    subAccountName: LEDGER_HEADER.find((h) => h.name === "補助科目名")!.column,
    postingDate: LEDGER_HEADER.find((h) => h.name === "計上日")!.column,
    debit: LEDGER_HEADER.find((h) => h.name === "借方入力金額")!.column,
    debitTax: LEDGER_HEADER.find((h) => h.name === "借方入力税額")!.column,
    credit: LEDGER_HEADER.find((h) => h.name === "貸方入力金額")!.column,
    creditTax: LEDGER_HEADER.find((h) => h.name === "貸方入力税額")!.column,
  } as const;

  const self = canonicalBranchCode(opts.selfBranch);
  const counter = canonicalBranchCode(opts.counterBranch);

  const byDay: Map<DayKey, number[]> = new Map();

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const branchCode = canonicalBranchCode(asText(row.getCell(col.branchCode).value));
    const accountCode = asText(row.getCell(col.accountCode).value);
    const postingDate = asText(row.getCell(col.postingDate).value);
    if (branchCode !== self) continue; // 選択支店のみ
    if (accountCode !== INTERBRANCH_ACCOUNT_CODE) continue; // 本支店勘定のみ
    if (!/^\d{8}$/.test(postingDate)) continue;
    if (!isInPeriod(postingDate, opts.period)) continue;

    // 相手先支店コードの解決（サブ科目コード→支店コード優先、なければ名称から）
    const subCode = asText(row.getCell(col.subAccountCode).value);
    const subName = asText(row.getCell(col.subAccountName).value);
    const resolved =
      resolveBranchCodeBySubaccount(subCode) ?? resolveCounterpartyCodeFromSubName(subName) ?? null;
    if (!resolved) continue;
    const counterResolved = canonicalBranchCode(resolved);
    if (counterResolved !== counter) continue; // もう片側に向く明細のみ

    const amountDebit = toNumber(row.getCell(col.debit).value) + toNumber(row.getCell(col.debitTax).value);
    const amountCredit = toNumber(row.getCell(col.credit).value) + toNumber(row.getCell(col.creditTax).value);
    const signed = amountDebit - amountCredit; // 借方-貸方

    if (!byDay.has(postingDate)) byDay.set(postingDate, []);
    byDay.get(postingDate)!.push(signed);
  }

  return byDay;
}

export async function ledgerReconcileAction(form: FormData) {
  try {
    const period = String(form.get("period") || ""); // YYYY-MM
    const branchA = String(form.get("branchA") || "");
    const branchB = String(form.get("branchB") || "");
    const fileA = form.get("ledgerA") as File | null;
    const fileB = form.get("ledgerB") as File | null;
    const ledgerAUrl = String(form.get("ledgerAUrl") || "");
    const ledgerBUrl = String(form.get("ledgerBUrl") || "");

    if (!period || !/^[0-9]{4}-[0-9]{2}$/.test(period)) return { ok: false, error: "対象期間(YYYY-MM)が不正です" };
    if (!branchA || !branchB) return { ok: false, error: "支店A/Bを選択してください" };
    if (branchA === branchB) return { ok: false, error: "支店Aと支店Bは異なる支店を選択してください" };
    // 入力は Blob URL 優先。なければ従来の File 入力を許容（後方互換）
    let bufA: ArrayBuffer | null = null;
    let bufB: ArrayBuffer | null = null;

    if (ledgerAUrl && ledgerBUrl) {
      const [ra, rb] = await Promise.all([fetch(ledgerAUrl), fetch(ledgerBUrl)]);
      if (!ra.ok || !rb.ok) return { ok: false, error: "元帳ファイルの取得に失敗しました（Blob URL）" };
      [bufA, bufB] = await Promise.all([ra.arrayBuffer(), rb.arrayBuffer()]);
    } else {
      if (!fileA || !fileB) return { ok: false, error: "元帳ファイルが不足しています" };
      [bufA, bufB] = await Promise.all([fileA.arrayBuffer(), fileB.arrayBuffer()]);
    }

    const byDayA = await parseLedgerFromBuffer(bufA, { period, selfBranch: branchA, counterBranch: branchB });
    const byDayB = await parseLedgerFromBuffer(bufB, { period, selfBranch: branchB, counterBranch: branchA });

    // 出力整形（各日付でA→B, B→A を横並び）
    const days = monthDays(period);
    const maxA = Math.max(0, ...days.map((d) => (byDayA.get(d)?.length ?? 0)));
    const maxB = Math.max(0, ...days.map((d) => (byDayB.get(d)?.length ?? 0)));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("by_day");
    const header = [
      "date",
      ...Array.from({ length: maxA }, (_, i) => `A${i + 1}`),
      ...Array.from({ length: maxB }, (_, i) => `B${i + 1}`),
      "sumA",
      "sumB",
      "diff",
    ];
    ws.addRow(header);

    for (const d of days) {
      const arrA = byDayA.get(d) ?? [];
      const arrB = byDayB.get(d) ?? [];
      const sumA = arrA.reduce((a, b) => a + b, 0);
      const sumB = arrB.reduce((a, b) => a + b, 0);
      const row = [
        `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        ...[...arrA, ...Array(Math.max(0, maxA - arrA.length)).fill("")],
        ...[...arrB, ...Array(Math.max(0, maxB - arrB.length)).fill("")],
        sumA,
        sumB,
        sumA + sumB,
      ];
      ws.addRow(row);
    }

    // 目印として先頭行に支店名も追加（別シート）
    const info = wb.addWorksheet("info");
    const nameA = BRANCHES.find((b) => b.code === branchA)?.name ?? branchA;
    const nameB = BRANCHES.find((b) => b.code === branchB)?.name ?? branchB;
    info.addRow(["period", period]);
    info.addRow(["branchA", nameA, branchA]);
    info.addRow(["branchB", nameB, branchB]);

    const ab = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const base64 = Buffer.from(ab).toString("base64");
    const filename = `ledger-match_${period}_${branchA}-${branchB}.xlsx`;
    return {
      ok: true,
      file: { name: filename, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64 },
    };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
