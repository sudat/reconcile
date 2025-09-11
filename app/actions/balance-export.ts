"use server";

import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { waitNeonReady } from "@/lib/neon";
import { DEPARTMENTS } from "@/constants/masterdata/departments";
import { SUBJECTS } from "@/constants/masterdata/subjects";

type ExportFileData = {
  name: string;
  base64: string;
  mime: string;
};

export async function balanceExportAction(form: FormData) {
  try {
    const ym = String(form.get("ym") || "");

    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
      return { ok: false as const, error: "対象年月(YYYY-MM)が不正です" };
    }

    await waitNeonReady("balance-export");

    // データセット一覧を取得
    const datasets = await prisma.dataset.findMany({
      where: {
        ym,
        status: "ready"
      },
      include: {
        entries: {
          where: {
            softDeletedAt: null
          },
          orderBy: [
            { date: "asc" },
            { voucherNo: "asc" }
          ]
        },
        projects: {
          where: {
            isDeleted: false
          },
          include: {
            entries: {
              include: {
                entry: true
              }
            }
          },
          orderBy: {
            orderNo: "asc"
          }
        }
      }
    });

    if (datasets.length === 0) {
      return { ok: false as const, error: "指定年月のデータが見つかりません" };
    }

    // 部門別にデータをグループ化
    const dataByDept = new Map<string, typeof datasets>();

    for (const dataset of datasets) {
      if (!dataByDept.has(dataset.deptCode)) {
        dataByDept.set(dataset.deptCode, []);
      }
      dataByDept.get(dataset.deptCode)!.push(dataset);
    }

    const files: ExportFileData[] = [];

    // 各部門のExcelファイルを生成
    for (const [deptCode, deptDatasets] of dataByDept) {
      const deptName = DEPARTMENTS.find(d => d.code === deptCode)?.name || deptCode;
      
      const wb = new ExcelJS.Workbook();

      // 各科目をシートとして追加
      for (const dataset of deptDatasets) {
        const subjectName = SUBJECTS.find(s => s.code === dataset.subjectCode)?.name || dataset.subjectCode;
        const sheetName = `${dataset.subjectCode}_${subjectName}`.slice(0, 31); // Excel シート名制限
        
        const ws = wb.addWorksheet(sheetName);

        // ヘッダー行を追加
        const headerRow = [
          "日付",
          "伝票番号", 
          "取引先コード",
          "取引先名",
          "摘要",
          "借方",
          "貸方",
          "差額",
          "案件名"
        ];
        ws.addRow(headerRow);

        // ヘッダースタイル設定
        const headerRowObj = ws.getRow(1);
        headerRowObj.font = { bold: true };
        headerRowObj.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE0E0E0" }
        };

        // 案件と仕訳のマッピングを作成
        const entryToProject = new Map<string, string>();
        for (const project of dataset.projects) {
          for (const link of project.entries) {
            entryToProject.set(link.entryId, project.name);
          }
        }

        // データ行を追加
        for (const entry of dataset.entries) {
          const projectName = entryToProject.get(entry.id) || "未分類";
          const debitAmount = Number(entry.debit);
          const creditAmount = Number(entry.credit);
          const difference = debitAmount - creditAmount; // 借方 - 貸方
          
          const row = [
            entry.date.toISOString().split('T')[0], // YYYY-MM-DD形式
            entry.voucherNo,
            entry.partnerCode,
            entry.partnerName,
            entry.memo,
            debitAmount,
            creditAmount,
            difference,
            projectName
          ];
          ws.addRow(row);
        }

        // 列幅を自動調整
        ws.columns = [
          { width: 12 }, // 日付
          { width: 15 }, // 伝票番号
          { width: 15 }, // 取引先コード
          { width: 20 }, // 取引先名
          { width: 30 }, // 摘要
          { width: 15 }, // 借方
          { width: 15 }, // 貸方
          { width: 15 }, // 差額
          { width: 20 }  // 案件名
        ];

        // 数値列の書式設定
        const lastRow = ws.rowCount;
        if (lastRow > 1) {
          ws.getColumn(6).numFmt = '#,##0'; // 借方
          ws.getColumn(7).numFmt = '#,##0'; // 貸方
          ws.getColumn(8).numFmt = '#,##0'; // 差額
        }
      }

      // Excelファイルをバッファとして出力
      const buffer = await wb.xlsx.writeBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      
      files.push({
        name: `${deptCode}.xlsx`,
        base64,
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
    }

    return {
      ok: true as const,
      files,
      ym,
      departmentCount: dataByDept.size,
      totalEntries: datasets.reduce((sum, ds) => sum + ds.entries.length, 0)
    };

  } catch (error) {
    console.error("Excel export error:", error);
    return { 
      ok: false as const, 
      error: error instanceof Error ? error.message : "Excel出力処理でエラーが発生しました" 
    };
  }
}