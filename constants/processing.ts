// 並列設定
export const PROCESSING = {
  // 部門×科目（スコープ）単位の並列数。
  // 月により増減するが、上限250で全並列をカバー（ユーザ要件）。
  maxParallelScopes: 250,
} as const;
