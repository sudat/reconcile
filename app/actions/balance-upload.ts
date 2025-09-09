"use server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";

function toDateStr(v: unknown): string {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "string" && v.trim()) {
    const t = v.trim().replaceAll("/", "-");
    const m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    return t;
  }
  if (typeof v === "number") {
    const base = new Date(1899, 11, 30);
    const d = new Date(base.getTime() + v * 24 * 60 * 60 * 1000);
    if (!isNaN(d.getTime())) return toDateStr(d);
  }
  return "";
}

function toText(v: unknown): string {
  return (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.replace(/[\,\s]/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function isMonthlyTotal(memo: string): boolean {
  const re = /[*＊]{2}[ \u3000]*[0-9０-９]+月計[ \u3000]*[*＊]{2}/;
  return re.test(memo);
}

function isCarryOver(memo: string): boolean {
  const re = /[*＊]{2}[ \u3000]*前月繰越[ \u3000]*[*＊]{2}/;
  return re.test(memo);
}

function rowKeyOf(x: {
  date: string;
  voucherNo: string;
  partnerCode: string;
  memo: string;
  debit: number;
  credit: number;
}): string {
  const norm = [x.date, x.voucherNo, x.partnerCode, x.memo, x.debit, x.credit]
    .map((v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : String(v)))
    .join("|");
  return createHash("sha256").update(norm).digest("hex");
}

const COL = {
  DEPT_CODE: 6, // F
  DEPT_NAME: 7, // G
  SUBJECT_CODE: 9, // I
  SUBJECT_ABBR: 10, // J
  DATE: 22, // V
  VOUCHER_NO: 26, // Z
  PARTNER_CODE: 30, // AD
  PARTNER_NAME: 31, // AE
  DEBIT: 34, // AH
  CREDIT: 36, // AJ
  BALANCE: 38, // AL
  MEMO1: 39, // AM
} as const;

export async function importBalanceDatasetAction(form: FormData) {
  try {
    const ym = String(form.get("ym") || ""); // YYYY-MM
    const fileUrl = String(form.get("fileUrl") || "");
    const file = form.get("file") as File | null;
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return { ok: false as const, error: "対象年月(YYYY-MM)が不正です" };
    if (!fileUrl && !file) return { ok: false as const, error: "Excelファイルが未指定です" };

    // 1) バイナリ取得
    let ab: ArrayBuffer;
    if (fileUrl) {
      const r = await fetch(fileUrl);
      if (!r.ok) return { ok: false as const, error: "Excelファイルの取得に失敗しました（Blob URL）" };
      ab = await r.arrayBuffer();
    } else if (file) {
      ab = await file.arrayBuffer();
    } else {
      return { ok: false as const, error: "Excelファイルが見つかりません" };
    }

    const fileBuf = Buffer.from(ab);
    const fileHash = createHash("sha256").update(fileBuf).digest("hex");

    // 2) Excel パース（1シート目）
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(ab);
    const ws = wb.worksheets[0];
    if (!ws) return { ok: false as const, error: "シートが見つかりません" };

    // グルーピング: (deptCode, subjectCode) ごとに当該YMの明細を集約
    type ParsedRow = {
      date: string;
      voucherNo: string;
      partnerCode: string;
      partnerName: string;
      memo: string;
      debit: number;
      credit: number;
      balance: number;
      rowKey: string;
    };
    const groups = new Map<string, { deptCode: string; subjectCode: string; rows: ParsedRow[] }>();
    const isInYm = (date: string) => date.startsWith(ym + "-");

    ws.eachRow((row) => {
      const dept = toText(row.getCell(COL.DEPT_CODE).value);
      const subject = toText(row.getCell(COL.SUBJECT_CODE).value);
      if (!dept || !subject) return;

      const memo = toText(row.getCell(COL.MEMO1).value);
      if (!memo) return; // ヘッダ/空行
      if (isMonthlyTotal(memo)) return; // 月計除外
      if (isCarryOver(memo)) return; // 繰越は別管理（今は除外）

      const date = toDateStr(row.getCell(COL.DATE).value);
      if (!date || !isInYm(date)) return; // 月度外は今回対象外

      const voucherNo = toText(row.getCell(COL.VOUCHER_NO).value);
      const partnerCode = toText(row.getCell(COL.PARTNER_CODE).value);
      const partnerName = toText(row.getCell(COL.PARTNER_NAME).value);
      const debit = toNumber(row.getCell(COL.DEBIT).value);
      const credit = toNumber(row.getCell(COL.CREDIT).value);
      const balance = toNumber(row.getCell(COL.BALANCE).value);

      const rk = rowKeyOf({ date, voucherNo, partnerCode, memo, debit, credit });
      const key = `${dept}|${subject}`;
      const g = groups.get(key) ?? { deptCode: dept, subjectCode: subject, rows: [] };
      g.rows.push({ date, voucherNo, partnerCode, partnerName, memo, debit, credit, balance, rowKey: rk });
      groups.set(key, g);
    });

    // 3) DB 反映（グループ単位でUPSERT + 洗替）
    const results: { datasetId: string; deptCode: string; subjectCode: string; count: number }[] = [];
    const fileName = String(form.get("fileName") || "uploaded.xlsx");
    const fileSize = Number(form.get("fileSize") || fileBuf.length);
    const now = new Date();

    for (const g of groups.values()) {
      const { deptCode, subjectCode, rows } = g;
      // dataset を processing にセット
      const dataset = await prisma.dataset.upsert({
        where: { deptCode_subjectCode_ym: { deptCode, subjectCode, ym } },
        update: { status: "processing" },
        create: { deptCode, subjectCode, ym, status: "processing" },
      });

      const job = await prisma.importJob.create({
        data: { datasetId: dataset.id, fileName, fileSize, fileHash, status: "processing" },
      });

      await prisma.$transaction(async (tx) => {
        // 既存有効行
        const existing = await tx.entry.findMany({
          where: { datasetId: dataset.id, softDeletedAt: null },
          select: { id: true, rowKey: true },
        });
        const newRowKeys = new Set<string>();

        for (const r of rows) {
          newRowKeys.add(r.rowKey);
          const dateObj = new Date(r.date);
          await tx.entry.upsert({
            where: { datasetId_rowKey: { datasetId: dataset.id, rowKey: r.rowKey } },
            update: {
              date: dateObj,
              voucherNo: r.voucherNo,
              partnerCode: r.partnerCode,
              partnerName: r.partnerName,
              memo: r.memo,
              debit: BigInt(Math.trunc(r.debit)),
              credit: BigInt(Math.trunc(r.credit)),
              balance: BigInt(Math.trunc(r.balance)),
              softDeletedAt: null,
              importJobId: job.id,
            },
            create: {
              datasetId: dataset.id,
              rowKey: r.rowKey,
              date: dateObj,
              voucherNo: r.voucherNo,
              partnerCode: r.partnerCode,
              partnerName: r.partnerName,
              memo: r.memo,
              debit: BigInt(Math.trunc(r.debit)),
              credit: BigInt(Math.trunc(r.credit)),
              balance: BigInt(Math.trunc(r.balance)),
              softDeletedAt: null,
              importJobId: job.id,
            },
          });
        }

        // 今回存在しない既存行は論理削除
        const toDelete = existing.filter((e) => !newRowKeys.has(e.rowKey)).map((e) => e.id);
        if (toDelete.length > 0) {
          await tx.entry.updateMany({ where: { id: { in: toDelete } }, data: { softDeletedAt: now, importJobId: job.id } });
        }

        // 件数更新 + job成功
        const currentCount = await tx.entry.count({ where: { datasetId: dataset.id, softDeletedAt: null } });
        await tx.dataset.update({ where: { id: dataset.id }, data: { status: "ready", entryCount: currentCount } });
        await tx.importJob.update({ where: { id: job.id }, data: { status: "succeeded" } });
      });

      results.push({ datasetId: dataset.id, deptCode, subjectCode, count: rows.length });
    }

    return { ok: true as const, ym, datasets: results, totalGroups: results.length };
  } catch (e: unknown) {
    console.error(e);
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}
