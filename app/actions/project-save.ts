"use server";

import { prisma } from "@/lib/prisma";
import { waitNeonReady } from "@/lib/neon";
import type { Project } from "@/types/balance-detail";

type ProjectSaveResult =
  | {
      ok: true;
      saved: number;
      linked: number;
    }
  | {
      ok: false;
      error: string;
    };

export async function saveProjectsAction(form: FormData): Promise<ProjectSaveResult> {
  await waitNeonReady("project-save");
  
  const ym = String(form.get("ym") || "");
  const deptCode = String(form.get("deptCode") || "");
  const subjectCode = String(form.get("subjectCode") || "");
  const projectsJson = String(form.get("projects") || "[]");
  
  if (!ym || !deptCode || !subjectCode) {
    return { ok: false, error: "年月、部門、科目が必要です" };
  }
  
  let projects: Project[];
  try {
    projects = JSON.parse(projectsJson);
  } catch (e) {
    return { ok: false, error: "プロジェクトデータの解析に失敗しました" };
  }
  
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Dataset取得（存在チェック）
      const dataset = await tx.dataset.findUnique({
        where: {
          deptCode_subjectCode_ym: {
            deptCode,
            subjectCode,
            ym,
          },
        },
        select: { id: true },
      });
      
      if (!dataset) {
        throw new Error(`データセットが見つかりません: ${ym} ${deptCode} ${subjectCode}`);
      }
      
      // 既存のProjectEntry削除（Dataset配下の全Project）
      const existingProjects = await tx.project.findMany({
        where: { datasetId: dataset.id },
        select: { id: true },
      });
      
      if (existingProjects.length > 0) {
        const existingProjectIds = existingProjects.map(p => p.id);
        await tx.projectEntry.deleteMany({
          where: { projectId: { in: existingProjectIds } },
        });
      }
      
      // 既存のProject削除
      await tx.project.deleteMany({
        where: { datasetId: dataset.id },
      });
      
      // ProjectEntryデータを構築するため、元のプロジェクトIDと新規作成するデータをマッピング
      const projectMappings = projects.map((p, index) => {
        // 代表的な取引先名を決定（最初に見つかった取引先名を使用）
        const representativePartnerName = p.entries.find(e => e.partnerName)?.partnerName?.trim() || null;
        
        return {
          originalId: p.id,
          name: p.name,
          orderNo: index,
          entries: p.entries,
          dataForCreate: {
            datasetId: dataset.id,
            name: p.name,
            partnerName: representativePartnerName,
            orderNo: index,
            isDeleted: false,
          }
        };
      });
      
      // 新しいProject作成
      if (projectMappings.length > 0) {
        await tx.project.createMany({
          data: projectMappings.map(pm => pm.dataForCreate),
        });
      }
      
      // 作成されたProjectのIDを取得してマッピング
      const createdProjects = await tx.project.findMany({
        where: { datasetId: dataset.id },
        select: { id: true, name: true, orderNo: true },
        orderBy: { orderNo: "asc" },
      });
      
      // ProjectEntry作成
      const entriesData: { projectId: string; entryId: string }[] = [];
      projectMappings.forEach((mapping) => {
        // orderNoで確実に一致するプロジェクトを特定
        const createdProject = createdProjects.find(cp => cp.orderNo === mapping.orderNo);
        if (createdProject) {
          mapping.entries.forEach((entry) => {
            entriesData.push({
              projectId: createdProject.id,
              entryId: entry.id,
            });
          });
        }
      });
      
      if (entriesData.length > 0) {
        const CHUNK_SIZE = 1000;
        for (let i = 0; i < entriesData.length; i += CHUNK_SIZE) {
          const chunk = entriesData.slice(i, i + CHUNK_SIZE);
          await tx.projectEntry.createMany({
            data: chunk,
            skipDuplicates: true,
          });
        }
      }
      
      return {
        saved: projectMappings.length,
        linked: entriesData.length,
      };
    });
    
    return {
      ok: true,
      saved: result.saved,
      linked: result.linked,
    };
  } catch (error) {
    console.error("Project save error:", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "保存処理に失敗しました",
    };
  }
}