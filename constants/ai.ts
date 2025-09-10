// AI設定: 案件自動グルーピング用
// 抽象化強度: 0.0 = 具体（メモに近い） / 1.0 = 極めて抽象（一般名詞に統一）
export const AI_GROUPING = {
  model: process.env.AI_GROUPING_MODEL || "gpt-4o-mini",
  abstraction: Number(process.env.AI_GROUPING_ABSTRACTION ?? 0.8),
  // 1回のプロンプトで扱う摘要種類の上限（取引先あたり）
  // トークン許容がある前提で既定を大きめに設定。
  maxMemosPerPartner: Number(process.env.AI_GROUPING_MAX_MEMOS ?? 10000),
} as const;
