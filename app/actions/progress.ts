"use server";

import { getProgress } from "@/lib/progress";

export async function getProgressAction(form: FormData) {
  const workflowId = String(form.get("workflowId") || "");
  if (!workflowId) return { ok: false as const, error: "workflowId が未指定です" };
  const p = getProgress(workflowId);
  if (!p) return { ok: true as const, progress: { done: 0, total: 0, percent: 0 } };
  const percent = p.total > 0 ? Math.min(100, Math.max(0, (p.done / p.total) * 100)) : 0;
  return { ok: true as const, progress: { done: p.done, total: p.total, percent } };
}

