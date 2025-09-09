// シンプルなコンソールログ専用
// ファイル出力は別の方法で実装

function ts() {
  return new Date().toISOString();
}

export function workflowLogPath(workflowId: string): string {
  return `log/${workflowId}_terminal.log`;
}

export function logTerminal(message: string): void {
  console.log(`[${ts()}][TERMINAL] ${message}`);
}

export function logWorkflow(workflowId: string, message: string): void {
  // 2個目の[]（ワークフローID）は先頭8桁のみ表示し、以降は省略
  const shortId = (workflowId || "").slice(0, 8) + (workflowId && workflowId.length > 8 ? "..." : "");
  const line = `[${ts()}][${shortId}] ${message}`;
  console.log(line);
}

export function initServerLogging(): void {
  console.log(`[${ts()}][SYSTEM] Logger initialized (console-only mode)`);
}
