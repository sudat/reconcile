export type Department = {
  code: string;
  name: string;
};

// 部門マスタ（PRD: 入力データ F/G 列のUIタブ用。KISS/DRY）
export const DEPARTMENTS: Department[] = [
  { code: "2100000000", name: "池袋" },
  { code: "2110000000", name: "上野" },
  { code: "2120000000", name: "錦糸町" },
  { code: "2150000000", name: "調布" },
  { code: "2170000000", name: "ひばりが丘" },
  { code: "2200000000", name: "渋谷" },
  { code: "2250000000", name: "吉祥寺" },
  { code: "2310000000", name: "心斎橋" },
  { code: "2350000000", name: "広島" },
  { code: "2430000000", name: "浦和" },
  { code: "2470000000", name: "福岡" },
  { code: "2500000000", name: "札幌" },
  { code: "2560000000", name: "仙台" },
  { code: "2580000000", name: "静岡" },
  { code: "2600000000", name: "名古屋" },
];

