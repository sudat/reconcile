"use server";
import ExcelJS from "exceljs";
import { LEDGER_HEADER } from "@/constants/reports/report-header";
import { BRANCHES } from "@/constants/masterdata/master-data";
import { SUBACCOUNT_BRANCH_MAP } from "@/constants/masterdata/subaccount-branch-map";
import { canonicalBranchCode } from "@/constants/masterdata/aliases";
import { resolveBranchCodeBySubaccount } from "@/constants/masterdata/subaccount-branch-map";
import { resolveCounterpartyCodeFromSubName } from "@/lib/counterparty";
import { maskBranchName } from "@/lib/mask";

const INTERBRANCH_ACCOUNT_CODE = "11652090";

type DayKey = string; // yyyymmdd
type LedgerCell = string | number;
type LedgerRow = {
  day: DayKey;
  rowIndex: number;
  cells: LedgerCell[]; // LEDGER_HEADER の順
  amountSigned: number; // (借方+借方税) - (貸方+貸方税)
};

function toNumber(x: unknown): number {
  if (x === null || typeof x === "undefined" || x === "") return 0;
  const n = typeof x === "number" ? x : Number(String(x).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function asText(x: unknown): string {
  // 元データのゼロ埋めを保持
  return String(x ?? "");
}

// Excelの計上日セルを yyyymmdd 文字列に正規化
function normalizeDate8(v: unknown): string | null {
  if (v == null || v === "") return null;
  // ExcelJS は日付セルを Date で返すことがある
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}${m}${d}`;
  }
  // 文字列の場合は数字だけ抽出して先頭8桁を採用（例: 2025-03-01, 2025/03/01, 20250301）
  const s = String(v).trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 8) return digits.slice(0, 8);
  return null;
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

  const byDay: Map<DayKey, { amount: number; sub: string }[]> = new Map();
  const rowsByDay: Map<DayKey, LedgerRow[]> = new Map();

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const branchCode = canonicalBranchCode(asText(row.getCell(col.branchCode).value));
    const accountCode = asText(row.getCell(col.accountCode).value);
    const postingDate = normalizeDate8(row.getCell(col.postingDate).value);
    if (branchCode !== self) continue; // 選択支店のみ
    if (accountCode !== INTERBRANCH_ACCOUNT_CODE) continue; // 本支店勘定のみ
    if (!postingDate) continue;
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
    byDay.get(postingDate)!.push({ amount: signed, sub: subCode });

    // アンマッチファイル用に元帳の全列も保持
    const cells: LedgerCell[] = LEDGER_HEADER.map((h) =>
      h.type === "number" ? toNumber(row.getCell(h.column).value) : asText(row.getCell(h.column).value)
    );
    if (!rowsByDay.has(postingDate)) rowsByDay.set(postingDate, []);
    rowsByDay.get(postingDate)!.push({ day: postingDate, rowIndex: r, cells, amountSigned: signed });
  }

  return { byDay, rowsByDay };
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

    if (!period || !/^[0-9]{4}-[0-9]{2}$/.test(period)) return { ok: false as const, error: "対象期間(YYYY-MM)が不正です" };
    if (!branchA || !branchB) return { ok: false as const, error: "支店A/Bを選択してください" };
    if (branchA === branchB) return { ok: false as const, error: "支店Aと支店Bは異なる支店を選択してください" };
    // 入力は Blob URL 優先。なければ従来の File 入力を許容（後方互換）
    let bufA: ArrayBuffer | null = null;
    let bufB: ArrayBuffer | null = null;

    if (ledgerAUrl && ledgerBUrl) {
      const [ra, rb] = await Promise.all([fetch(ledgerAUrl), fetch(ledgerBUrl)]);
      if (!ra.ok || !rb.ok) return { ok: false as const, error: "元帳ファイルの取得に失敗しました（Blob URL）" };
      [bufA, bufB] = await Promise.all([ra.arrayBuffer(), rb.arrayBuffer()]);
    } else {
      if (!fileA || !fileB) return { ok: false as const, error: "元帳ファイルが不足しています" };
      [bufA, bufB] = await Promise.all([fileA.arrayBuffer(), fileB.arrayBuffer()]);
    }

    const parsedA = await parseLedgerFromBuffer(bufA, { period, selfBranch: branchA, counterBranch: branchB });
    const parsedB = await parseLedgerFromBuffer(bufB, { period, selfBranch: branchB, counterBranch: branchA });
    const byDayA = parsedA.byDay;
    const byDayB = parsedB.byDay;

    // 出力整形（各日付でA→B, B→A を横並び）
    const days = monthDays(period);

    // 列は相手支店向けの補助科目コードで固定化
    const counterForA = canonicalBranchCode(branchB);
    const counterForB = canonicalBranchCode(branchA);
    const subColsA = Array.from(
      new Set(
        SUBACCOUNT_BRANCH_MAP.filter((x) => x.branchCode && canonicalBranchCode(x.branchCode) === counterForA).map(
          (x) => x.subAccount
        )
      )
    ).sort();
    const subColsB = Array.from(
      new Set(
        SUBACCOUNT_BRANCH_MAP.filter((x) => x.branchCode && canonicalBranchCode(x.branchCode) === counterForB).map(
          (x) => x.subAccount
        )
      )
    ).sort();

    // 列が多すぎる場合は安全側でエラー（ユーザ要望）
    if (subColsA.length > 20 || subColsB.length > 20)
      return { ok: false as const, error: "補助科目の列数が多すぎます（>20）。設計見直しが必要です。" };

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("by_day");
    const header = [
      "date",
      ...subColsA.map((c) => `Sub:A_${c}`),
      ...subColsB.map((c) => `Sub:B_${c}`),
      "sumA",
      "sumB",
      "diff",
    ];
    ws.addRow(header);

    const diffDays: string[] = [];
    const daySummary: { date8: string; sumA: number; sumB: number; diff: number }[] = [];
    for (const d of days) {
      const arrA = byDayA.get(d) ?? [];
      const arrB = byDayB.get(d) ?? [];
      const sumA = arrA.reduce((a, b) => a + b.amount, 0);
      const sumB = arrB.reduce((a, b) => a + b.amount, 0);
      const sumBy = (arr: { amount: number; sub: string }[], code: string) => {
        let has = false;
        const s = arr.reduce((acc, x) => {
          if (x.sub === code) {
            has = true;
            return acc + x.amount;
          }
          return acc;
        }, 0);
        return has ? s : "";
      };
      const cellsA = subColsA.map((c) => sumBy(arrA, c));
      const cellsB = subColsB.map((c) => sumBy(arrB, c));
      const row = [
        `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        ...cellsA,
        ...cellsB,
        sumA,
        sumB,
        sumA + sumB,
      ];
      ws.addRow(row);
      if (sumA + sumB !== 0) diffDays.push(d);
      daySummary.push({ date8: d, sumA, sumB, diff: sumA + sumB });
    }

    // 目印として先頭行に支店名も追加（別シート）
    const info = wb.addWorksheet("info");
    const nameA = BRANCHES.find((b) => b.code === branchA)?.name ?? branchA;
    const nameB = BRANCHES.find((b) => b.code === branchB)?.name ?? branchB;
    info.addRow(["period", period]);
    // 表示のみマスク適用（出力ファイルの見た目だけ変更、ロジック非影響）
    info.addRow(["branchA", maskBranchName(nameA), branchA]);
    info.addRow(["branchB", maskBranchName(nameB), branchB]);

    const ab = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const base64 = Buffer.from(ab).toString("base64");
    const filename = `ledger-match_${period}_${branchA}-${branchB}.xlsx`;

    // アンマッチ抽出: diff != 0 の日のみ対象
    let unmatchCountA = 0;
    let unmatchCountB = 0;
    const unmatchedA: LedgerRow[] = [];
    const unmatchedB: LedgerRow[] = [];

    if (diffDays.length > 0) {
      for (const d of diffDays) {
        const rowsA = (parsedA.rowsByDay.get(d) ?? []).slice();
        const rowsB = (parsedB.rowsByDay.get(d) ?? []).slice();

        // B側を金額（符号付き）でグルーピング
        // 相殺条件は a.amountSigned + b.amountSigned === 0（符号反転で同額）
        const mapB = new Map<number, LedgerRow[]>();
        for (const r of rowsB) {
          const key = r.amountSigned;
          const list = mapB.get(key) ?? [];
          list.push(r);
          mapB.set(key, list);
        }

        const matchedB = new Set<LedgerRow>();
        for (const a of rowsA) {
          const key = -a.amountSigned; // 反対符号で一致するBを探す
          const list = mapB.get(key);
          if (list && list.length > 0) {
            const b = list.shift()!; // 1つだけ消費
            matchedB.add(b);
            // Aも消費 → 除外（何もしない）
          } else {
            unmatchedA.push(a);
            unmatchCountA++;
          }
        }

        // マッチしなかったBを残りとして追加
        for (const b of rowsB) {
          if (!matchedB.has(b)) {
            unmatchedB.push(b);
            unmatchCountB++;
          }
        }
      }
    }

    // 片方もなければ既存どおり単独ファイルを返却
    if (unmatchedA.length === 0 && unmatchedB.length === 0) {
      return {
        ok: true as const,
        files: [
          {
            name: filename,
            mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            base64,
          },
        ],
      };
    }

    // アンマッチファイルを生成
    const wbU = new ExcelJS.Workbook();
    const wsU = wbU.addWorksheet("unmatched");
    const headerU = [
      ...LEDGER_HEADER.map((h) => `A:${h.name}`),
      ...LEDGER_HEADER.map((h) => `B:${h.name}`),
    ];
    wsU.addRow(headerU);

    // Aの未一致行 → 左にA、右は空
    for (const a of unmatchedA) {
      const row: (string | number | null)[] = [];
      row.push(...a.cells);
      row.push(...Array(LEDGER_HEADER.length).fill(""));
      wsU.addRow(row);
    }
    // Bの未一致行 → 左は空、右にB
    for (const b of unmatchedB) {
      const row: (string | number | null)[] = [];
      row.push(...Array(LEDGER_HEADER.length).fill(""));
      row.push(...b.cells);
      wsU.addRow(row);
    }

    const abU = (await wbU.xlsx.writeBuffer()) as ArrayBuffer;
    const base64U = Buffer.from(abU).toString("base64");
    const filenameU = `ledger-unmatch_${period}_${branchA}-${branchB}.xlsx`;

    // --- AI 分析用の最小ペイロードを作成（クライアント→APIで使用） ---
    const idxByName = (name: string) => LEDGER_HEADER.findIndex((h) => h.name === name);
    const I = {
      postingDate: idxByName("計上日"),
      subCode: idxByName("補助科目コード"),
      subName: idxByName("補助科目名"),
      voucherNo: idxByName("仕訳番号"),
      desc: idxByName("伝票摘要"),
      debit: idxByName("借方入力金額"),
      debitTax: idxByName("借方入力税額"),
      credit: idxByName("貸方入力金額"),
      creditTax: idxByName("貸方入力税額"),
    } as const;
    const toNumberSafe = (x: unknown) => (typeof x === "number" ? x : Number(String(x ?? "").replace(/,/g, "")) || 0);
    const toText = (x: unknown) => String(x ?? "");

    type AnalysisItem = {
      side: "A" | "B";
      day: string; // yyyymmdd
      subAccountCode: string;
      subAccountName: string;
      amountSigned: number;
      debit: number;
      credit: number;
      voucherNo: string;
      description: string;
      rowIndex: number;
    };

    const toAnalysisItem = (side: "A" | "B", r: LedgerRow): AnalysisItem => {
      const c = r.cells;
      const debit = toNumberSafe(c[I.debit]) + toNumberSafe(c[I.debitTax]);
      const credit = toNumberSafe(c[I.credit]) + toNumberSafe(c[I.creditTax]);
      return {
        side,
        day: r.day,
        subAccountCode: toText(c[I.subCode]),
        subAccountName: toText(c[I.subName]),
        amountSigned: r.amountSigned,
        debit,
        credit,
        voucherNo: toText(c[I.voucherNo]),
        description: toText(c[I.desc]),
        rowIndex: r.rowIndex,
      };
    };

    const analysisPayload = {
      period,
      branchA,
      branchB,
      daySummary,
      itemsA: unmatchedA.map((r) => toAnalysisItem("A", r)).slice(0, 1000),
      itemsB: unmatchedB.map((r) => toAnalysisItem("B", r)).slice(0, 1000),
    };

    return {
      ok: true as const,
      files: [
        {
          name: filename,
          mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          base64,
        },
        {
          name: filenameU,
          mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          base64: base64U,
        },
      ],
      meta: {
        hasUnmatch: true,
        diffDays: diffDays.length,
        unmatchCountA,
        unmatchCountB,
      },
      analysis: analysisPayload,
    };
  } catch (e: unknown) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}
