export type Entry = {
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

export type Project = {
  id: string;
  name: string;
  partnerName?: string | null;
  total: number;
  entries: Entry[];
};

export type Dataset = {
  deptCode: string;
  deptName: string;
  subjectCode: string;
  subjectName: string;
  carryOver: number;
  projects: Project[];
};
