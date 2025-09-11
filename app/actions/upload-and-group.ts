"use server";
import { importBalanceDatasetAction } from "@/app/actions/balance-upload";
import { ensureAutoGrouping } from "@/app/actions/project-autogroup";
import { PROCESSING } from "@/constants/processing";
import { formatUploadTraceTitle, withSpan, withWorkflowTrace } from "@/lib/tracing";
import { logWorkflow } from "@/lib/logger";
import { randomUUID } from "crypto";
import { setProgress /*, clearProgress*/ } from "@/lib/progress";

type DatasetScope = { deptCode: string; subjectCode: string };

export async function uploadAndGroupAllAction(form: FormData) {
  const ym = String(form.get("ym") || "");
  const workflowId = String(form.get("workflowId") || randomUUID());
  const fileName = String(form.get("fileName") || "uploaded.xlsx");
  const title = formatUploadTraceTitle(new Date());

  return withWorkflowTrace({ workflowId, name: title, metadata: { ym, fileName } }, async () => {
    // 1) DB永続化
    const persisted = await importBalanceDatasetAction(form);
    if (!persisted || persisted.ok === false) return persisted;

    const datasets = (persisted.datasets ?? []) as DatasetScope[];
    
    // 2) 部門別にグループ化
    const departmentGroups = new Map<string, DatasetScope[]>();
    for (const dataset of datasets) {
      const deptScopes = departmentGroups.get(dataset.deptCode) ?? [];
      deptScopes.push(dataset);
      departmentGroups.set(dataset.deptCode, deptScopes);
    }
    
    const departments = Array.from(departmentGroups.keys());
    const totalDepartments = departments.length;
    const totalScopes = datasets.length;
    let doneDepartments = 0;

    async function runLimited<T>(items: T[], limit: number, task: (item: T, idx: number) => Promise<void>) {
      const workers = new Array(Math.min(limit, items.length)).fill(0).map(async (_v, widx) => {
        for (let idx = widx; idx < items.length; idx += limit) {
          await task(items[idx], idx);
        }
      });
      await Promise.all(workers);
    }

    // 進捗初期化（部門ベース）
    setProgress(workflowId, 0, totalDepartments);

    // 3) 各部門のAI分類（部門内の全科目をまとめて1回のOpenAI呼び出し）
    await runLimited(departments, PROCESSING.maxParallelDepartments, async (deptCode, idx) => {
      await withSpan({ name: `dept ${deptCode}`, metadata: { idx: idx + 1, total: totalDepartments, ym } }, async () => {
        const deptScopes = departmentGroups.get(deptCode)!;
        
        // 部門内の全科目をまとめて処理（統合AI呼び出し）
        const f = new FormData();
        f.set("ym", ym);
        f.set("deptCode", deptCode);
        f.set("workflowId", workflowId);
        f.set("subjectCodes", JSON.stringify(deptScopes.map(s => s.subjectCode)));
        await ensureAutoGrouping(f);
        
        doneDepartments += 1;
        // 進捗更新（%表示）
        setProgress(workflowId, doneDepartments, totalDepartments);
        const percent = totalDepartments > 0 ? Math.round((doneDepartments / totalDepartments) * 100) : 0;
        logWorkflow(
          workflowId,
          `部門処理完了: ${doneDepartments}/${totalDepartments} (${percent}%) 部門=${deptCode}, 科目数=${deptScopes.length}`
        );
      });
    });

    // 進捗完了
    setProgress(workflowId, totalDepartments, totalDepartments);
    logWorkflow(workflowId, `自動グループ化 全完了: 対象部門=${totalDepartments}件, 対象部門×科目=${totalScopes}件`);
    return { ...persisted, ok: true as const, workflowId };
  });
}
