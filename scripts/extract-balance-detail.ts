// YAGNI / KISS: Excel -> JSON 抽出の最小実装。
// 依存: exceljs（既存）を利用し、DB用意までの暫定データ生成。

import ExcelJS from "exceljs";
import { writeFileSync } from "fs";
import { resolve } from "path";

type Entry = {
  id: string;
  date: string; // V列: 伝票日付
  voucherNo: string; // Z列: 伝票番号
  partnerCode: string; // AD列
  partnerName: string; // AE列
  memo: string; // AM列: 明細摘要１
  debit: number; // AH列: 借方金額
  credit: number; // AJ列: 貸方金額
  balance: number; // AL列: 残高
  month: "prev" | "current";
};

type Project = {
  id: string;
  name: string;
  total: number; // entries の (debit - credit) 合計
  entries: Entry[];
};

type Output = {
  deptCode: string;
  deptName: string;
  subjectCode: string;
  subjectName: string;
  carryOver: number;
  projects: Project[];
};

// 列インデックス（1-based）
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

function toDateString(v: unknown): string {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "string" && v.trim()) {
    // 文字列日付はそのまま（YYYY/MM/DD 等）→ 正規化（YYYY-MM-DD）を軽く対応
    const t = v.trim().replaceAll("/", "-");
    const m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) {
      const y = m[1];
      const mm = m[2].padStart(2, "0");
      const dd = m[3].padStart(2, "0");
      return `${y}-${mm}-${dd}`;
    }
    return t;
  }
  if (typeof v === "number") {
    // Excel シリアル日付の可能性 → 1900/1/1 起点
    const base = new Date(1899, 11, 30); // Excel 乖離調整
    const d = new Date(base.getTime() + v * 24 * 60 * 60 * 1000);
    if (!isNaN(d.getTime())) return toDateString(d);
  }
  return "";
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.replace(/[,\s]/g, "");
    const n = Number(s);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function normalizeString(v: unknown): string {
  return (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
}

function isMonthlyTotal(memo: string): boolean {
  // 例: 「＊＊　８月計　＊＊」(全角/半角混在対応)
  const re = /[*＊]{2}[ \u3000]*[0-9０-９]+月計[ \u3000]*[*＊]{2}/;
  return re.test(memo);
}

function isCarryOver(memo: string): boolean {
  // 例: 「＊＊　前月繰越　＊＊」(全角/半角混在対応)
  const re = /[*＊]{2}[ \u3000]*前月繰越[ \u3000]*[*＊]{2}/;
  return re.test(memo);
}

function deriveCategoryFromMemo(memo: string): string | null {
  if (/印刷/.test(memo)) return "印刷関連";
  if (/賃借料/.test(memo)) return "賃借料";
  if (/サービス券/.test(memo)) return "サービス券";
  if (/(開発|システム)/.test(memo)) return "システム開発";
  return null;
}

async function main() {
  // CLI 引数
  const args = Object.fromEntries(
    process.argv.slice(2).flatMap((a) => {
      const m = a.match(/^--([^=]+)=(.*)$/);
      return m ? [[m[1], m[2]]] : [];
    })
  ) as Record<string, string>;

  const file = resolve(
    process.cwd(),
    args.file || "docs/balance-detail/SS総勘定元帳_テストデータ.xlsx"
  );
  const deptFilter = args.dept || "2100000000"; // 例: 池袋
  const subjectFilter = args.subject || "21701"; // 例: 未払費用
  const out = resolve(
    process.cwd(),
    args.out || "app/balance-detail/sample-data.json"
  );

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const ws = workbook.worksheets[0];
  if (!ws) throw new Error("ワークシートが見つかりません");

  const entries: Entry[] = [];
  let carryOver = 0;
  let deptNameSeen = "";
  let subjectNameSeen = "";

  ws.eachRow((row, rowNumber) => {
    // 列抽出
    const dept = normalizeString(row.getCell(COL.DEPT_CODE).value);
    const subject = normalizeString(row.getCell(COL.SUBJECT_CODE).value);
    if (dept !== deptFilter || subject !== subjectFilter) return;

    const deptName = normalizeString(row.getCell(COL.DEPT_NAME).value);
    const subjectName = normalizeString(row.getCell(COL.SUBJECT_ABBR).value);
    if (!deptNameSeen && deptName) deptNameSeen = deptName;
    if (!subjectNameSeen && subjectName) subjectNameSeen = subjectName;

    const memo = normalizeString(row.getCell(COL.MEMO1).value);
    if (!memo) return; // ヘッダ/空行スキップ
    if (isMonthlyTotal(memo)) return; // 月計は除外

    if (isCarryOver(memo)) {
      carryOver += toNumber(row.getCell(COL.BALANCE).value);
      return;
    }

    const dateStr = toDateString(row.getCell(COL.DATE).value);
    const voucherNo = normalizeString(row.getCell(COL.VOUCHER_NO).value);
    const partnerCode = normalizeString(row.getCell(COL.PARTNER_CODE).value);
    const partnerName = normalizeString(row.getCell(COL.PARTNER_NAME).value);
    const debit = toNumber(row.getCell(COL.DEBIT).value);
    const credit = toNumber(row.getCell(COL.CREDIT).value);
    const balance = toNumber(row.getCell(COL.BALANCE).value);

    const id = `${dept}-${subject}-${rowNumber}`;
    entries.push({
      id,
      date: dateStr,
      voucherNo,
      partnerCode,
      partnerName,
      memo,
      debit,
      credit,
      balance,
      month: "current", // 暫定: すべて current とする
    });
  });

  // プロジェクト割当方針（ユーザ要望）：
  // 1) 取引先名が存在する場合は必ず取引先名でグルーピング
  // 2) 取引先名が空の場合のみ、摘要キーワードによるカテゴリ名を採用
  // 3) どちらも得られない場合は「その他」
  const grouped = new Map<string, Entry[]>();
  for (const e of entries) {
    const partner = normalizeString(e.partnerName);
    const key = partner || deriveCategoryFromMemo(e.memo) || "その他";
    const list = grouped.get(key) || [];
    list.push(e);
    grouped.set(key, list);
  }

  // すべて個別プロジェクト化（統合上限なし）。絶対額降順で安定表示。
  const sortedGroups = Array.from(grouped.entries())
    .map(([name, es]) => ({ name, es, totalAbs: Math.abs(es.reduce((s, x) => s + (x.debit - x.credit), 0)) }))
    .sort((a, b) => b.totalAbs - a.totalAbs);

  const projects: Project[] = sortedGroups.map((p, idx) => ({
    id: `p${idx + 1}`,
    name: p.name,
    entries: p.es,
    total: p.es.reduce((s, e) => s + (e.debit - e.credit), 0),
  }));

  const output: Output = {
    deptCode: deptFilter,
    deptName: deptNameSeen,
    subjectCode: subjectFilter,
    subjectName: subjectNameSeen,
    carryOver,
    projects,
  };
  writeFileSync(out, JSON.stringify(output, null, 2));
  // eslint-disable-next-line no-console
  console.log(`✅ Wrote ${projects.length} projects. carryOver=${carryOver} -> ${out}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
