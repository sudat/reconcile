// シンプルなプロセス内進捗ストア（開発・単一インスタンス想定）
// 本番の多インスタンス環境ではDBや外部KVへの置き換えを検討する。

type Progress = { total: number; done: number; updatedAt: number };

declare global {
  // eslint-disable-next-line no-var
  var __workflowProgressStore: Map<string, Progress> | undefined;
}

function store(): Map<string, Progress> {
  if (!globalThis.__workflowProgressStore) {
    globalThis.__workflowProgressStore = new Map<string, Progress>();
  }
  return globalThis.__workflowProgressStore;
}

export function setProgress(workflowId: string, done: number, total: number): void {
  const s = store();
  s.set(workflowId, { done, total, updatedAt: Date.now() });
}

export function getProgress(workflowId: string): Progress | null {
  const s = store();
  return s.get(workflowId) ?? null;
}

export function clearProgress(workflowId: string): void {
  const s = store();
  s.delete(workflowId);
}

