"use server";
import { importBalanceDatasetAction } from "@/app/actions/balance-upload";
import { ensureAutoGrouping } from "@/app/actions/project-autogroup";
import { PROCESSING } from "@/constants/processing";
import { formatUploadTraceTitle, withSpan, withWorkflowTrace } from "@/lib/tracing";
import { logWorkflow } from "@/lib/logger";
import { randomUUID } from "crypto";
import { setProgress, clearProgress } from "@/lib/progress";

type DatasetScope = { deptCode: string; subjectCode: string };

export async function uploadAndGroupAllAction(form: FormData) {
  const ym = String(form.get("ym") || "");
  const workflowId = String(form.get("workflowId") || randomUUID());
  const fileName = String(form.get("fileName") || "uploaded.xlsx");
  const title = formatUploadTraceTitle(new Date());

  return withWorkflowTrace({ workflowId, name: title, metadata: { ym, fileName } }, async () => {
    // 1) DBへ永続化
    const persisted = await importBalanceDatasetAction(form);
    if (!persisted || persisted.ok === false) return persisted;

    const datasets = (persisted.datasets ?? []) as DatasetScope[];
    const total = datasets.length;
    let done = 0;

    async function runLimited<T>(items: T[], limit: number, task: (item: T, idx: number) => Promise<void>) {
      const workers = new Array(Math.min(limit, items.length)).fill(0).map(async (_v, widx) => {
        for (let idx = widx; idx < items.length; idx += limit) {
          await task(items[idx], idx);
        }
      });
      await Promise.all(workers);
    }

    // 進捗初期化（ブラウザ側でポーリング表示するため）
    setProgress(workflowId, 0, total);

    // 2) 各スコープのAI分類
    await runLimited(datasets, PROCESSING.maxParallelScopes, async (d, idx) => {
      await withSpan({ name: `scope ${d.deptCode}-${d.subjectCode}`, metadata: { idx: idx + 1, total, ym } }, async () => {
        const f = new FormData();
        f.set("ym", ym);
        f.set("deptCode", d.deptCode);
        f.set("subjectCode", d.subjectCode);
        f.set("workflowId", workflowId);
        await ensureAutoGrouping(f);
        done += 1;
        // 進捗更新（%表示）
        setProgress(workflowId, done, total);
        const percent = total > 0 ? Math.round((done / total) * 100) : 0;
        logWorkflow(
          workflowId,
          `自動グループ化 進捗: ${done}/${total} (${percent}%) 部門=${d.deptCode}, 科目=${d.subjectCode}`
        );
      });
    });

    // 進捗完了
    setProgress(workflowId, total, total);
    logWorkflow(workflowId, `自動グループ化 全完了: 対象部門×科目=${total}件`);
    return { ...persisted, ok: true as const, workflowId };
  });
}
