import { setTracingExportApiKey, withTrace, withCustomSpan, withResponseSpan } from "@openai/agents";

// Initialize exporter once per process
let inited = false;
export function initTracing() {
  if (inited) return;
  const key = process.env.OPENAI_API_KEY || (process.env as Record<string, string | undefined>).OPEN_API_KEY;
  if (key) setTracingExportApiKey(key);
  inited = true;
}

export async function withWorkflowTrace<T>(opts: { workflowId: string; name?: string; metadata?: Record<string, unknown> }, fn: () => Promise<T>) {
  initTracing();
  return withTrace(
    opts.name ?? "balance-upload",
    fn,
    { metadata: { workflowId: opts.workflowId, ...(opts.metadata || {}) } }
  );
}

// child span helper: fallback to withTrace (Agents SDK will nest spans if supported)
export async function withSpan<T>(opts: { name: string; metadata?: Record<string, unknown> }, fn: () => Promise<T>) {
  initTracing();
  // Prefer explicit CustomSpan soダッシュボードで名前が見やすい
  return withCustomSpan(fn, { data: { name: opts.name, data: opts.metadata || {} } });
}

// Wrap a single Responses API call with a ResponseSpan so that
// the OpenAIダッシュボードの「POST /v1/responses」行と紐づく
export async function withResponseTracing<T extends { id: string }>(
  run: () => Promise<T>,
  options?: { input?: unknown; attachResponse?: boolean }
) {
  initTracing();
  return withResponseSpan(async (span) => {
    const res = await run();
    try {
      // Link the span to the actual response id for Traces UI
      (span as any).spanData.response_id = (res as any).id;
      if (options?.input !== undefined) (span as any).spanData._input = options.input as any;
      if (options?.attachResponse) (span as any).spanData._response = res as any;
    } catch {}
    return res;
  });
}

// Helper to format the top-level trace title for file uploads
export function formatUploadTraceTitle(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${y}/${m}/${d} ${hh}:${mm}:${ss} ファイルアップロード`;
}
