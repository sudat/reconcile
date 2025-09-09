"use server";
import { prisma } from "@/lib/prisma";
import { waitNeonReady } from "@/lib/neon";

export async function preloadAllDatasetsAction(form: FormData) {
  await waitNeonReady("preload-all");
  const ym = String(form.get("ym") || "");
  if (!ym) return { ok: false as const, error: "ymが必要です" };
  const list = await prisma.dataset.findMany({
    where: { ym, status: "ready" },
    select: { deptCode: true, subjectCode: true },
    orderBy: [{ deptCode: "asc" }, { subjectCode: "asc" }],
  });
  return { ok: true as const, items: list };
}

