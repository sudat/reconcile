"use server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { waitNeonReady } from "@/lib/neon";
import { createHash, randomUUID } from "crypto";
import { logWorkflow } from "@/lib/logger";

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

const logLine = logWorkflow;

export async function importBalanceDatasetAction(form: FormData) {
  try {
    const ym = String(form.get("ym") || ""); // YYYY-MM
    const fileUrl = String(form.get("fileUrl") || "");
    const file = form.get("file") as File | null;
    const workflowId = String(form.get("workflowId") || randomUUID());
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return { ok: false as const, error: "対象年月(YYYY-MM)が不正です" };
    if (!fileUrl && !file) return { ok: false as const, error: "Excelファイルが未指定です" };

    // Neon 起動待ち（コールドスタート対策）
    await waitNeonReady("balance-upload");

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
    // 日本語化: アップロード（Excel受信）の開始を明示
    logLine(workflowId, `Excel受信開始: 月度=${ym}, サイズ=${fileBuf.length}B`);
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
    const monthsPresent = new Set<string>();
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
      monthsPresent.add(date.slice(0, 7));
    });

    if (groups.size === 0) {
      const months = Array.from(monthsPresent.values()).sort();
      const hint = months.length > 0 ? `（ファイル内の月度: ${months.join(", ")}）` : "";
      return { ok: false as const, error: `指定の年月(${ym})に一致する明細がありません${hint}` };
    }

    // 3) DB 反映（一括処理でパフォーマンス向上）
    const results: { datasetId: string; deptCode: string; subjectCode: string; count: number }[] = [];
    const fileName = String(form.get("fileName") || "uploaded.xlsx");
    const fileSize = Number(form.get("fileSize") || fileBuf.length);

    // 日本語化: 洗い替え処理開始
    logLine(workflowId, `洗い替え処理開始: 対象部門×科目=${groups.size}件 - 一括削除・一括挿入方式`);

    // 一括トランザクション内で全データセット処理（タイムアウト延長）
    await prisma.$transaction(async (tx) => {
      // 1) 全データセットとジョブを事前作成
      const datasetMap = new Map<string, { id: string; importJobId: string }>();
      
      for (const g of groups.values()) {
        const { deptCode, subjectCode } = g;
        const dataset = await tx.dataset.upsert({
          where: { deptCode_subjectCode_ym: { deptCode, subjectCode, ym } },
          update: { status: "processing" },
          create: { deptCode, subjectCode, ym, status: "processing" },
        });

        const job = await tx.importJob.create({
          data: { datasetId: dataset.id, fileName, fileSize, fileHash, status: "processing" },
        });

        datasetMap.set(`${deptCode}|${subjectCode}`, { id: dataset.id, importJobId: job.id });
      }

      // 2) 【新方式】対象データセットIDを一括特定
      const targetDatasetIds = Array.from(datasetMap.values()).map(ds => ds.id);
      logLine(workflowId, `対象データセット特定完了: ${targetDatasetIds.length}件`);

      // 3) 【新方式】一括削除処理（ProjectEntry → Project → Entry）
      logLine(workflowId, `一括削除開始: 対象データセット=${targetDatasetIds.length}件`);
      
      // Step1: 対象Entryを特定
      const targetEntries = await tx.entry.findMany({
        where: { datasetId: { in: targetDatasetIds } },
        select: { id: true },
      });
      const targetEntryIds = targetEntries.map(e => e.id);
      logLine(workflowId, `削除対象Entry特定: ${targetEntryIds.length}件`);

      // Step2: ProjectEntry一括削除
      if (targetEntryIds.length > 0) {
        const deleteProjectEntriesResult = await tx.projectEntry.deleteMany({
          where: { entryId: { in: targetEntryIds } }
        });
        logLine(workflowId, `ProjectEntry一括削除完了: ${deleteProjectEntriesResult.count}件`);
      }

      // Step3: Project一括削除
      const deleteProjectsResult = await tx.project.deleteMany({
        where: { datasetId: { in: targetDatasetIds } }
      });
      logLine(workflowId, `Project一括削除完了: ${deleteProjectsResult.count}件`);

      // Step4: Entry一括削除
      const deleteEntriesResult = await tx.entry.deleteMany({
        where: { datasetId: { in: targetDatasetIds } }
      });
      logLine(workflowId, `Entry一括削除完了: ${deleteEntriesResult.count}件`);

      // 4) 【新方式】全Entryデータを準備して一括挿入
      logLine(workflowId, `一括挿入開始`);
      const allEntriesData = [];
      
      for (const g of groups.values()) {
        const { deptCode, subjectCode, rows } = g;
        const dsInfo = datasetMap.get(`${deptCode}|${subjectCode}`)!;

        if (rows.length > 0) {
          // 重複データの事前チェック
          const rowKeySet = new Set<string>();
          const duplicateKeys = new Set<string>();
          rows.forEach(r => {
            if (rowKeySet.has(r.rowKey)) {
              duplicateKeys.add(r.rowKey);
            } else {
              rowKeySet.add(r.rowKey);
            }
          });
          
          if (duplicateKeys.size > 0) {
            logLine(workflowId, `重複データ検出: ${duplicateKeys.size}件のrowKeyが重複 (部門=${deptCode}, 科目=${subjectCode})`);
          }

          const data = rows.map((r) => ({
            datasetId: dsInfo.id,
            rowKey: r.rowKey,
            date: new Date(r.date),
            voucherNo: r.voucherNo,
            partnerCode: r.partnerCode,
            partnerName: r.partnerName,
            memo: r.memo,
            debit: BigInt(Math.trunc(r.debit)),
            credit: BigInt(Math.trunc(r.credit)),
            balance: BigInt(Math.trunc(r.balance)),
            softDeletedAt: null as Date | null,
            importJobId: dsInfo.importJobId,
          }));
          
          allEntriesData.push(...data);
        }
        results.push({ datasetId: dsInfo.id, deptCode, subjectCode, count: rows.length });
      }

      // 全Entryを一括挿入（チャンクサイズを調整）
      const CREATE_CHUNK = 1000;
      let totalInserted = 0;
      for (let i = 0; i < allEntriesData.length; i += CREATE_CHUNK) {
        const chunk = allEntriesData.slice(i, i + CREATE_CHUNK);
        await tx.entry.createMany({ 
          data: chunk, 
          skipDuplicates: true // 重複データをスキップして処理継続
        });
        totalInserted += chunk.length;
        logLine(workflowId, `Entry挿入進捗: ${totalInserted}/${allEntriesData.length}件`);
      }
      
      logLine(workflowId, `Entry一括挿入完了: ${allEntriesData.length}件`);

      // 5) 全データセットのステータス更新
      for (const result of results) {
        const currentCount = await tx.entry.count({ 
          where: { datasetId: result.datasetId, softDeletedAt: null } 
        });
        const dsInfo = Array.from(datasetMap.values()).find(ds => ds.id === result.datasetId)!;
        
        await tx.dataset.update({ 
          where: { id: result.datasetId }, 
          data: { status: "ready", entryCount: currentCount } 
        });
        await tx.importJob.update({ 
          where: { id: dsInfo.importJobId }, 
          data: { status: "succeeded" } 
        });
      }
    }, {
      maxWait: 600000, // 10分（洗い替え処理のため延長）
      timeout: 600000  // 10分（洗い替え処理のため延長）
    });
    // 日本語化: 洗い替え処理完了
    logLine(workflowId, `洗い替え処理完了: 対象部門×科目=${results.length}件 - 一括方式により大幅高速化`);
    return { ok: true as const, ym, datasets: results, totalGroups: results.length, workflowId };
  } catch (e: unknown) {
    console.error(e);
    try {
      const workflowId = String(form.get("workflowId") || "");
      if (workflowId) logLine(workflowId, `error ${e instanceof Error ? e.message : String(e)}`);
    } catch {}
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}
