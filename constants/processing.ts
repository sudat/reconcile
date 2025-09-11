// 並列設定
export const PROCESSING = {
  // 部門単位での並列数（コネクションプール負荷軽減のため67→15に削減）
  maxParallelDepartments: 20,
} as const;
