export type Subject = {
  code: string;
  name: string;
};

// 科目マスタ（UIタブ用。PRD: I/J 列に対応。KISS/DRY）
export const SUBJECTS: Subject[] = [
  { code: "12101", name: "前払費用" },
  { code: "12406", name: "専門店保険仮払金" },
  { code: "12414", name: "社員仮払金" },
  { code: "12419", name: "その他仮払金" },
  { code: "21419", name: "一般未払金" },
  { code: "21701", name: "未払費用" },
  { code: "21422", name: "一般未払金(加算)" },
];

