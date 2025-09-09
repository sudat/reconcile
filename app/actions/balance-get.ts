"use server";
import { prisma } from "@/lib/prisma";
import { waitNeonReady } from "@/lib/neon";
import type { Dataset, Project, Entry } from "@/types/balance-detail";
import { DEPARTMENTS } from "@/constants/masterdata/departments";
import { SUBJECTS } from "@/constants/masterdata/subjects";
import { ensureAutoGrouping } from "@/app/actions/project-autogroup";

function prevYm(ym: string): string | null {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mm = Number(m[2]);
  const d = new Date(y, mm - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function n(x: bigint | number | null | undefined): number {
  if (x == null) return 0;
  return Number(x);
}

export async function getBalanceDetailAction(form: FormData) {
  await waitNeonReady("balance-get");
  const ym = String(form.get("ym") || "");
  const deptCode = String(form.get("deptCode") || "");
  const subjectCode = String(form.get("subjectCode") || "");
  if (!ym || !deptCode || !subjectCode) return { ok: false as const, error: "パラメータが不足しています" };

  const deptName = DEPARTMENTS.find((d) => d.code === deptCode)?.name ?? deptCode;
  const subjectName = SUBJECTS.find((s) => s.code === subjectCode)?.name ?? subjectCode;

  const ds = await prisma.dataset.findUnique({
    where: { deptCode_subjectCode_ym: { deptCode, subjectCode, ym } },
    select: { id: true },
  });
  if (!ds) return { ok: false as const, error: "該当データセットが存在しません" };

  // 初回は自動グルーピング（案件作成）を実施
  const existingCount = await prisma.project.count({ where: { datasetId: ds.id, isDeleted: false } });
  if (existingCount === 0) {
    const f = new FormData();
    f.set("ym", ym);
    f.set("deptCode", deptCode);
    f.set("subjectCode", subjectCode);
    await ensureAutoGrouping(f);
  }

  // 既存プロジェクトを取得（非削除・並び順）
  const projectsDb = await prisma.project.findMany({
    where: { datasetId: ds.id, isDeleted: false },
    orderBy: { orderNo: "asc" },
    select: { id: true, name: true },
  });
  const links = await prisma.projectEntry.findMany({
    where: { projectId: { in: projectsDb.map((p) => p.id) } },
    select: { projectId: true, entryId: true },
  });
  const entryIdsLinked = new Set(links.map((l) => l.entryId));

  const entriesDb = await prisma.entry.findMany({
    where: { datasetId: ds.id, softDeletedAt: null },
    orderBy: [{ date: "asc" }, { voucherNo: "asc" }],
  });

  // 割当済みのプロジェクトを先に復元
  const projs: Project[] = projectsDb.map((p) => ({ id: p.id, name: p.name, total: 0, entries: [] }));
  const byId = new Map(projs.map((p) => [p.id, p] as const));

  const toEntry = (e: typeof entriesDb[number], month: "current" | "prev"): Entry => ({
    id: e.id,
    date: e.date.toISOString().slice(0, 10),
    voucherNo: e.voucherNo,
    partnerCode: e.partnerCode,
    partnerName: e.partnerName,
    memo: e.memo,
    debit: n(e.debit),
    credit: n(e.credit),
    balance: n(e.balance),
    month,
  });

  for (const e of entriesDb) {
    const link = links.find((l) => l.entryId === e.id);
    if (link && byId.has(link.projectId)) {
      byId.get(link.projectId)!.entries.push(toEntry(e, "current"));
    }
  }
  // total再計算
  for (const p of projs) p.total = p.entries.reduce((s, x) => s + (x.debit - x.credit), 0);

  // 未割当は「未分類」プロジェクトとしてまとめる（初期表示用）
  const unassigned = entriesDb.filter((e) => !entryIdsLinked.has(e.id));
  if (unassigned.length > 0) {
    projs.push({
      id: "unclassified",
      name: "未分類",
      entries: unassigned.map((e) => toEntry(e, "current")),
      total: unassigned.reduce((s, e) => s + (n(e.debit) - n(e.credit)), 0),
    });
  }

  // 前月（参考表示、集計は含めない）
  const prev = prevYm(ym);
  if (prev) {
    const prevDs = await prisma.dataset.findUnique({
      where: { deptCode_subjectCode_ym: { deptCode, subjectCode, ym: prev } },
      select: { id: true },
    });
    if (prevDs) {
      const prevEntries = await prisma.entry.findMany({
        where: { datasetId: prevDs.id, softDeletedAt: null },
        orderBy: [{ date: "asc" }, { voucherNo: "asc" }],
      });
      if (prevEntries.length > 0) {
        projs.push({
          id: "prev-only",
          name: `前月参照(${prev})`,
          entries: prevEntries.map((e) => toEntry(e, "prev")),
          total: prevEntries.reduce((s, e) => s + (n(e.debit) - n(e.credit)), 0),
        });
      }
    }
  }

  const dataset: Dataset = {
    deptCode,
    deptName,
    subjectCode,
    subjectName,
    carryOver: 0,
    projects: projs,
  };

  return { ok: true as const, dataset };
}
