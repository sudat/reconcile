export type HEADER_TYPE = {
  column: number;
  name: string;
  type: "text" | "number";
};

// 試算表のヘッダー定義
// column: Excelの列番号（1始まり）
// name: Excelでのヘッダー名
// type: Excelでボディに入る値
// 補足としてcolumn19は0か1かの区分値が入る。
export const TB_HEADER: HEADER_TYPE[] = [
  { column: 6, name: "対象組織コード", type: "text" },
  { column: 7, name: "対象組織名", type: "text" },
  { column: 11, name: "勘定科目コード", type: "text" },
  { column: 12, name: "勘定科目名", type: "text" },
  { column: 13, name: "補助科目コード", type: "text" },
  { column: 14, name: "補助科目名", type: "text" },
  { column: 19, name: "科目貸借区分", type: "text" },
  { column: 20, name: "科目貸借区分名", type: "text" },
  { column: 22, name: "期間前基準金額", type: "number" },
  { column: 23, name: "期間内借方基準金額", type: "number" },
  { column: 24, name: "期間内貸方基準金額", type: "number" },
  { column: 25, name: "累計基準金額", type: "number" },
];

// 総勘定元帳のヘッダー定義
// column: Excelの列番号（1始まり）
// name: Excelでのヘッダー名
// type: Excelでボディに入る値
export const LEDGER_HEADER: HEADER_TYPE[] = [
  { column: 12, name: "対象組織コード", type: "text" },
  { column: 13, name: "対象組織名", type: "text" },
  { column: 14, name: "勘定科目コード", type: "text" },
  { column: 15, name: "勘定科目名", type: "text" },
  { column: 18, name: "仕訳番号", type: "text" },
  { column: 37, name: "計上日", type: "text" },
  { column: 45, name: "伝票摘要", type: "text" },
  { column: 75, name: "貸借区分", type: "text" },
  { column: 77, name: "行番号", type: "text" },
  { column: 86, name: "勘定科目コード", type: "text" },
  { column: 87, name: "勘定科目名", type: "text" },
  { column: 88, name: "補助科目コード", type: "text" },
  { column: 89, name: "補助科目名", type: "text" },
  { column: 97, name: "借方入力金額", type: "number" },
  { column: 99, name: "借方入力税額", type: "number" },
  { column: 101, name: "貸方入力金額", type: "number" },
  { column: 103, name: "貸方入力税額", type: "number" },
];
