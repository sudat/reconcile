export type SUBACCOUNT_TYPE = {
  name: string;
  subAccount: string;
};

export type ACCOUNT_TYPE = {
  name: string;
  mainAccount: string;
  subAccount: SUBACCOUNT_TYPE[] | null;
};

export const ACCOUNTS: ACCOUNT_TYPE[] = [
  {
    name: "仮払金（本支店取引）",
    mainAccount: "11652090",
    subAccount: [
      { name: "心斎橋店本支店取引", subAccount: "0001" },
      { name: "心斎橋店回金", subAccount: "0002" },
      { name: "心斎橋店買掛金立替決済", subAccount: "0003" },
      { name: "心斎橋店給与立替決済", subAccount: "0004" },
      { name: "心斎橋店賞与立替決済", subAccount: "0005" },
      { name: "東京店本支店取引", subAccount: "0006" },
      { name: "東京店回金", subAccount: "0007" },
      { name: "東京店買掛金立替決済", subAccount: "0008" },
      { name: "東京店給与立替決済", subAccount: "0009" },
      { name: "東京店賞与立替決済", subAccount: "0010" },
      { name: "京都店本支店取引", subAccount: "0011" },
      { name: "京都店回金", subAccount: "0012" },
      { name: "京都店買掛金立替決済", subAccount: "0013" },
      { name: "京都店給与立替決済", subAccount: "0014" },
      { name: "京都店賞与立替決済", subAccount: "0015" },
      { name: "神戸店本支店取引", subAccount: "0016" },
      { name: "神戸店回金", subAccount: "0017" },
      { name: "神戸店買掛金立替決済", subAccount: "0018" },
      { name: "神戸店給与立替決済", subAccount: "0019" },
      { name: "神戸店賞与立替決済", subAccount: "0020" },
      { name: "梅田店本支店取引", subAccount: "0021" },
      { name: "梅田店回金", subAccount: "0022" },
      { name: "梅田店買掛金立替決済", subAccount: "0023" },
      { name: "梅田店給与立替決済", subAccount: "0024" },
      { name: "梅田店賞与立替決済", subAccount: "0025" },
      { name: "札幌店本支店取引", subAccount: "0026" },
      { name: "札幌店回金", subAccount: "0027" },
      { name: "札幌店買掛金立替決済", subAccount: "0028" },
      { name: "札幌店給与立替決済", subAccount: "0029" },
      { name: "札幌店賞与立替決済", subAccount: "0030" },
      { name: "名古屋店本支店取引", subAccount: "0031" },
      { name: "名古屋店回金", subAccount: "0032" },
      { name: "名古屋店買掛金立替決済", subAccount: "0033" },
      { name: "名古屋店給与立替決済", subAccount: "0034" },
      { name: "名古屋店賞与立替決済", subAccount: "0035" },
      { name: "上野店本支店取引", subAccount: "0036" },
      { name: "上野店回金", subAccount: "0037" },
      { name: "上野店買掛金立替決済", subAccount: "0038" },
      { name: "上野店給与立替決済", subAccount: "0039" },
      { name: "上野店賞与立替決済", subAccount: "0040" },
      { name: "静岡店本支店取引", subAccount: "0041" },
      { name: "静岡店回金", subAccount: "0042" },
      { name: "静岡店買掛金立替決済", subAccount: "0043" },
      { name: "静岡店給与立替決済", subAccount: "0044" },
      { name: "静岡店賞与立替決済", subAccount: "0045" },
      { name: "高槻店本支店取引", subAccount: "0046" },
      { name: "高槻店回金", subAccount: "0047" },
      { name: "高槻店買掛金立替決済", subAccount: "0048" },
      { name: "高槻店給与立替決済", subAccount: "0049" },
      { name: "高槻店賞与立替決済", subAccount: "0050" },
      { name: "法人外商本支店取引", subAccount: "0051" },
      { name: "法人外商回金", subAccount: "0052" },
      { name: "法人外商買掛金立替決済", subAccount: "0053" },
      { name: "法人外商給与立替決済", subAccount: "0054" },
      { name: "法人外商賞与立替決済", subAccount: "0055" },
      { name: "不動産本支店取引", subAccount: "0056" },
      { name: "本社本支店取引", subAccount: "0057" },
      { name: "本社回金", subAccount: "0058" },
      { name: "本社買掛金立替決済", subAccount: "0059" },
      { name: "本社給与立替決済", subAccount: "0060" },
      { name: "本社賞与立替決済", subAccount: "0061" },
      { name: "セグメント間消去本支店取引", subAccount: "0062" },
      { name: "下関店本支店取引", subAccount: "0063" },
      { name: "下関店回金", subAccount: "0064" },
      { name: "下関店買掛金立替決済", subAccount: "0065" },
      { name: "下関店給与立替決済", subAccount: "0066" },
      { name: "下関店賞与立替決済", subAccount: "0067" },
      { name: "須磨本支店取引", subAccount: "0068" },
      { name: "芦屋本支店取引", subAccount: "0069" },
    ],
  },
];

export type BRANCH_TYPE = {
  name: string;
  code: string;
};

export const BRANCHES: BRANCH_TYPE[] = [
  { name: "心斎橋店", code: "050000101" },
  { name: "東京店", code: "050000201" },
  { name: "京都店", code: "050000301" },
  { name: "高槻店", code: "050001401" },
  { name: "神戸店", code: "050000401" },
  { name: "須磨店", code: "050000402" },
  { name: "芦屋店", code: "050000403" },
  { name: "梅田店", code: "050000601" },
  { name: "札幌店", code: "050000701" },
  { name: "名古屋店", code: "050001001" },
  { name: "上野店", code: "050001101" },
  { name: "静岡店", code: "050001201" },
  { name: "法人外商", code: "050001601" },
  { name: "下関店", code: "050005301" },
  { name: "本社", code: "050004001" },
];
