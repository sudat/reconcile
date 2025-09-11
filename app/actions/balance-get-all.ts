"use server";
import { prisma } from "@/lib/prisma";
import { waitNeonReady } from "@/lib/neon";
import { ensureAutoGrouping } from "@/app/actions/project-autogroup";
import { PROCESSING } from "@/constants/processing";

function n(x: bigint | number | null | undefined): number {
  if (x == null) return 0;
  return Number(x);
}

export type BalanceAllOk = {
  ok: true;
  ym: string;
  scopes: Array<{ datasetId: string; deptCode: string; subjectCode: string }>;
  projects: Array<{ id: string; datasetId: string; name: string; partnerName: string | null; orderNo: number }>;
  links: Array<{ projectId: string; entryId: string }>;
  entries: Array<{
    id: string;
    datasetId: string;
    date: string; // ISO-YYYY-MM-DD
    voucherNo: string;
    partnerCode: string | null;
    partnerName: string | null;
    memo: string | null;
    debit: number;
    credit: number;
    balance: number;
  }>;
};

export type BalanceAllErr = { ok: false; error: string };

export async function getBalanceAllAction(form: FormData): Promise<BalanceAllOk | BalanceAllErr> {
  await waitNeonReady("balance-get-all");
  const ym = String(form.get("ym") || "");
  const autogroup = String(form.get("autogroup") || "true").toLowerCase() === "true";
  if (!ym) return { ok: false as const, error: "ymが必要です" };

  // 1) 当月のreadyデータセットを一覧
  const datasets = await prisma.dataset.findMany({
    where: { ym, status: "ready" },
    select: { id: true, deptCode: true, subjectCode: true },
    orderBy: [{ deptCode: "asc" }, { subjectCode: "asc" }],
  });

  // 2) 必要に応じて自動グルーピング（初回のみ）
  if (autogroup && datasets.length > 0) {
    // groupByでプロジェクトの存在状況を取得
    const grouped = await prisma.project.groupBy({ by: ["datasetId"], _count: { _all: true }, where: { datasetId: { in: datasets.map(d => d.id) }, isDeleted: false } });
    const hasProj = new Set(grouped.filter(g => (g._count?._all ?? 0) > 0).map(g => g.datasetId));
    const need = datasets.filter(d => !hasProj.has(d.id));
    if (need.length > 0) {
      // 部門別にグループ化して並列処理
      const departmentGroups = new Map<string, typeof need>();
      for (const dataset of need) {
        const deptScopes = departmentGroups.get(dataset.deptCode) ?? [];
        deptScopes.push(dataset);
        departmentGroups.set(dataset.deptCode, deptScopes);
      }
      
      const departments = Array.from(departmentGroups.keys());
      const limit = Math.min(PROCESSING.maxParallelDepartments, 20);
      
      await (async function runLimited() {
        const workers = new Array(Math.min(limit, departments.length)).fill(0).map(async (_v, widx) => {
          for (let idx = widx; idx < departments.length; idx += limit) {
            const deptCode = departments[idx];
            const deptScopes = departmentGroups.get(deptCode)!;
            
            // 部門内の全科目を順次処理
            for (const d of deptScopes) {
              const f = new FormData();
              f.set("ym", ym);
              f.set("deptCode", d.deptCode);
              f.set("subjectCode", d.subjectCode);
              await ensureAutoGrouping(f);
            }
          }
        });
        await Promise.all(workers);
      })();
    }
  }

  const datasetIds = datasets.map(d => d.id);
  if (datasetIds.length === 0)
    return { ok: true as const, ym, scopes: [], projects: [], links: [], entries: [] };

  // 3) プロジェクト/リンク/エントリを一括取得
  const projectsDb = await prisma.project.findMany({
    where: { datasetId: { in: datasetIds }, isDeleted: false },
    orderBy: [{ datasetId: "asc" }, { orderNo: "asc" }],
    select: { id: true, datasetId: true, name: true, partnerName: true, orderNo: true },
  });
  const linksDb = await prisma.projectEntry.findMany({
    where: { projectId: { in: projectsDb.map(p => p.id) } },
    select: { projectId: true, entryId: true },
  });
  const entriesDb = await prisma.entry.findMany({
    where: { datasetId: { in: datasetIds }, softDeletedAt: null },
    orderBy: [{ datasetId: "asc" }, { date: "asc" }, { voucherNo: "asc" }],
    select: { id: true, datasetId: true, date: true, voucherNo: true, partnerCode: true, partnerName: true, memo: true, debit: true, credit: true, balance: true },
  });

  // 4) 正規化して返却
  return {
    ok: true as const,
    ym,
    scopes: datasets.map(d => ({ datasetId: d.id, deptCode: d.deptCode, subjectCode: d.subjectCode })),
    projects: projectsDb,
    links: linksDb,
    entries: entriesDb.map(e => ({
      id: e.id,
      datasetId: e.datasetId,
      // ISO(YYYY-MM-DD)へ正規化（クライアント表示用に統一）
      date: (e.date instanceof Date ? e.date : new Date(e.date as unknown as string)).toISOString().slice(0, 10),
      voucherNo: e.voucherNo,
      partnerCode: (e as { partnerCode: string | null }).partnerCode ?? null,
      partnerName: (e as { partnerName: string | null }).partnerName ?? null,
      memo: (e as { memo: string | null }).memo ?? null,
      debit: n(e.debit),
      credit: n(e.credit),
      balance: n(e.balance),
    })),
  };
}
