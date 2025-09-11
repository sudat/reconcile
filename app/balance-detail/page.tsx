"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEPARTMENTS,
  type Department,
} from "@/constants/masterdata/departments";
import { SUBJECTS, type Subject } from "@/constants/masterdata/subjects";
import { HeaderBar } from "@/components/balance-detail/header-bar";
import { TabRow } from "@/components/balance-detail/tab-row";
import { ExpandAllToggle } from "@/components/balance-detail/expand-all-toggle";
import type { Dataset, Entry, Project } from "@/types/balance-detail";
import { Button } from "@/components/ui/button";
import { ProjectsTable } from "@/components/balance-detail/projects-table";
import { toast } from "sonner";
import { getBalanceAllAction } from "@/app/actions/balance-get-all";
import type {
  BalanceAllOk,
  BalanceAllErr,
} from "@/app/actions/balance-get-all";

type BalanceAllResult = BalanceAllOk | BalanceAllErr;
import { uploadAndGroupAllAction } from "@/app/actions/upload-and-group";
import { getProgressAction } from "@/app/actions/progress";
import { saveProjectsAction } from "@/app/actions/project-save";

const AUTO_SHOW_LATEST = true;

function currentYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function BalanceDetailPage() {
  // YAGNI/KISS: 固定のダミーデータと軽いUI状態のみ（サーバー処理なし）
  // 部門/科目はマスタ（constants）から参照（DRY/KISS）
  const departments: Department[] = useMemo(() => DEPARTMENTS, []);
  const subjects: Subject[] = useMemo(() => SUBJECTS, []);

  const [dept, setDept] = useState(departments[0]);
  const [subject, setSubject] = useState(subjects[0]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [yearMonth, setYearMonth] = useState<string>(currentYm());
  const [shownYm, setShownYm] = useState<string | null>(
    AUTO_SHOW_LATEST ? currentYm() : null
  );
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);

  const [data, setData] = useState<Dataset | null>(null);
  const [allStore, setAllStore] = useState<Extract<
    BalanceAllResult,
    { ok: true }
  > | null>(null);
  const hasMatch =
    !!data && dept.code === data.deptCode && subject.code === data.subjectCode;

  // 画面内編集用に案件配列をstate管理（D&Dや編集、削除に対応）
  const [projects, setProjects] = useState<Project[]>([]);
  const [originalProjects, setOriginalProjects] = useState<Project[]>([]);

  useEffect(() => {
    if (!shownYm || !data || !hasMatch) {
      setProjects([]);
      setOriginalProjects([]);
      return;
    }
    const projectsData = (data.projects ?? []).map((p) => ({
      ...p,
      entries: [...p.entries],
    }));
    setProjects(projectsData);
    setOriginalProjects(JSON.parse(JSON.stringify(projectsData))); // Deep copy
    // 展開状態はリセットしない（ユーザ操作優先）
  }, [shownYm, data, hasMatch]);

  // 一括トグルの状態
  const projectIds = projects.map((p) => p.id);
  const isAllOpen =
    projectIds.length > 0 && projectIds.every((id) => expanded[id]);

  const moveEntry = (entryId: string, fromId: string, toId: string) => {
    if (fromId === toId) return;
    setProjects((prev) => {
      const src = prev.find((p) => p.id === fromId);
      const dst = prev.find((p) => p.id === toId);
      if (!src || !dst) return prev;
      const entryIndex = src.entries.findIndex((e) => e.id === entryId);
      if (entryIndex < 0) return prev;
      const entry = src.entries[entryIndex];
      const newSrc: Project = {
        ...src,
        entries: src.entries.filter((e) => e.id !== entryId),
      };
      const newDst: Project = { ...dst, entries: [...dst.entries, entry] };
      const next = prev.map((p) =>
        p.id === src.id ? newSrc : p.id === dst.id ? newDst : p
      );
      return next;
    });
  };

  const reorderProjects = (
    dragId: string,
    overId: string,
    place: "before" | "after"
  ) => {
    if (dragId === overId) return;
    setProjects((prev) => {
      const arr = [...prev];
      const from = arr.findIndex((p) => p.id === dragId);
      const to = arr.findIndex((p) => p.id === overId);
      if (from < 0 || to < 0) return prev;
      const [moved] = arr.splice(from, 1);
      const insertIndex =
        place === "before"
          ? from < to
            ? to - 1
            : to
          : from < to
          ? to
          : to + 1;
      arr.splice(insertIndex, 0, moved);
      return arr;
    });
  };

  const ensureMiscProject = (): string => {
    const existing = projects.find((p) => p.name === "未分類");
    if (existing) return existing.id;
    const id = `p-${Math.random().toString(36).slice(2, 9)}`;
    const misc: Project = { id, name: "未分類", total: 0, entries: [] };
    setProjects((prev) => [...prev, misc]);
    return id;
  };

  const createProjectWithEntry = (e: Entry, fromProjectId: string) => {
    const id = `p-${Math.random().toString(36).slice(2, 9)}`;
    const proj: Project = { id, name: "新規案件", total: 0, entries: [e] };
    setProjects((prev) => {
      const srcIdx = prev.findIndex((p) => p.id === fromProjectId);
      if (srcIdx < 0) return prev;
      const newSrc: Project = {
        ...prev[srcIdx],
        entries: prev[srcIdx].entries.filter((x) => x.id !== e.id),
      };
      const next = [...prev];
      next[srcIdx] = newSrc;
      next.splice(srcIdx + 1, 0, proj);
      return next;
    });
    setExpanded((ex) => ({ ...ex, [id]: true }));
  };

  const deleteProject = (pid: string) => {
    setProjects((prev) => {
      const target = prev.find((p) => p.id === pid);
      if (!target) return prev;
      const rest = prev.filter((p) => p.id !== pid);
      if (target.entries.length === 0) return rest;
      const miscId = ensureMiscProject();
      return rest.map((p) =>
        p.id === miscId
          ? { ...p, entries: [...p.entries, ...target.entries] }
          : p
      );
    });
  };

  // 単一ペイロードから現在の部門・科目のDatasetに整形
  const buildDatasetFromAll = useCallback(
    (
      all: Extract<BalanceAllResult, { ok: true }>,
      _ym0: string,
      deptCode0: string,
      subjectCode0: string
    ): Dataset | null => {
      const scope = all.scopes.find(
        (s) => s.deptCode === deptCode0 && s.subjectCode === subjectCode0
      );
      if (!scope) return null;
      const dsId = scope.datasetId;
      const projsRaw = all.projects
        .filter((p) => p.datasetId === dsId)
        .sort((a, b) => a.orderNo - b.orderNo);
      const links = all.links.filter((l) =>
        projsRaw.some((p) => p.id === l.projectId)
      );
      const linkedByEntry = new Map<string, string>();
      for (const l of links) linkedByEntry.set(l.entryId, l.projectId);
      const entries = all.entries.filter((e) => e.datasetId === dsId);

      const projs = projsRaw.map((p) => ({
        id: p.id,
        name: p.name,
        partnerName: p.partnerName,
        total: 0,
        entries: [] as Entry[],
      }));
      const byId = new Map(projs.map((p) => [p.id, p] as const));
      const unassigned: Entry[] = [];
      for (const e of entries) {
        const pid = linkedByEntry.get(e.id);
        const entry: Entry = {
          id: e.id,
          date: e.date,
          voucherNo: e.voucherNo,
          partnerCode: e.partnerCode ?? "",
          partnerName: e.partnerName ?? "",
          memo: e.memo ?? "",
          debit: e.debit,
          credit: e.credit,
          balance: e.balance,
          month: "current",
        };
        if (pid && byId.has(pid)) byId.get(pid)!.entries.push(entry);
        else unassigned.push(entry);
      }
      if (unassigned.length > 0)
        projs.push({
          id: "unclassified",
          name: "未分類",
          partnerName: null,
          entries: unassigned,
          total: 0,
        });
      for (const p of projs)
        p.total = p.entries.reduce((s, x) => s + (x.debit - x.credit), 0);
      return {
        deptCode: deptCode0,
        deptName:
          departments.find((d) => d.code === deptCode0)?.name ?? deptCode0,
        subjectCode: subjectCode0,
        subjectName:
          subjects.find((s) => s.code === subjectCode0)?.name ?? subjectCode0,
        carryOver: 0,
        projects: projs,
      } satisfies Dataset;
    },
    [departments, subjects]
  );

  // タブ切替時に全件ペイロードから再構成（クライアント内で完結）
  useEffect(() => {
    if (!shownYm || !allStore) return;
    const ds = buildDatasetFromAll(allStore, shownYm, dept.code, subject.code);
    setData(ds);
  }, [shownYm, dept.code, subject.code, allStore, buildDatasetFromAll]);

  // 変更検知
  const hasChanges =
    JSON.stringify(projects) !== JSON.stringify(originalProjects);

  // 永続化
  const handlePersist = async () => {
    if (!shownYm || !hasMatch || projects.length === 0) return;

    try {
      // デバッグ用：送信するプロジェクトデータをログ出力
      console.log(
        "[DEBUG] Sending projects data:",
        projects.map((p) => ({
          id: p.id,
          name: p.name,
          entryCount: p.entries.length,
          entryIds: p.entries.map((e) => e.id),
        }))
      );

      const fd = new FormData();
      fd.set("ym", shownYm);
      fd.set("deptCode", dept.code);
      fd.set("subjectCode", subject.code);
      fd.set("projects", JSON.stringify(projects));

      const result = await saveProjectsAction(fd);

      if (result.ok) {
        // 成功時: 初期状態を更新
        setOriginalProjects(JSON.parse(JSON.stringify(projects)));
        toast.success(
          `保存完了: ${result.saved}案件、${result.linked}件の紐づけ`
        );
      } else {
        toast.error(`保存失敗: ${result.error}`);
      }
    } catch (error) {
      console.error("Save error:", error);
      toast.error("保存処理でエラーが発生しました");
    }
  };

  return (
    <main className="container mx-auto font-normal max-w-7xl">
      <div className="text-2xl font-bold mb-4  pb-2">残高明細</div>
      <HeaderBar
        yearMonth={yearMonth}
        onYearMonthChange={setYearMonth}
        loading={loading}
        onShow={async () => {
          setShownYm(yearMonth);
          setLoading(true);
          try {
            const fdAll = new FormData();
            fdAll.set("ym", yearMonth);
            fdAll.set("autogroup", "false"); // 表示時は自動グルーピングを無効化
            const all = await getBalanceAllAction(fdAll);
            if (!all || all.ok === false) {
              toast.warning(
                all?.ok === false ? all.error : "データが見つかりません"
              );
              setData(null);
              setAllStore(null);
              return;
            }
            setAllStore(all);
            const ds = buildDatasetFromAll(
              all,
              yearMonth,
              dept.code,
              subject.code
            );
            setData(ds);
          } catch (e) {
            console.error(e);
            toast.error("表示データの取得に失敗しました");
          } finally {
            setLoading(false);
          }
        }}
        uploading={uploading}
        statusText={statusText}
        onUploadFile={async (file, ym) => {
          if (!file) return;
          setUploading(true);
          setStatusText("[1. ファイルアップロード中...]");

          let timer: number | null = null;
          let currentStep = 1;

          try {
            const { upload } = await import("@vercel/blob/client");
            // 1) Blob へアップロード
            const up = await upload(file.name, file, {
              access: "public",
              handleUploadUrl: "/api/blob/upload",
              multipart: true,
            });

            setStatusText("[2. 仕訳データ保存中...]");
            currentStep = 2;

            // 2) Server Action でDB永続化＋AI分類（サーバ側でトップレベルトレース開始）
            const fd = new FormData();
            fd.set("ym", ym);
            fd.set("fileUrl", up.url);
            fd.set("fileName", file.name);
            fd.set("fileSize", String(file.size));
            // workflow id を生成してサーバへ渡す（ログ/トレースのひも付け）
            const workflowId = crypto.randomUUID();
            fd.set("workflowId", workflowId);

            // 進捗ポーリング（1秒間隔）を開始
            const startPolling = () => {
              timer = window.setInterval(async () => {
                try {
                  const pf = new FormData();
                  pf.set("workflowId", workflowId);
                  const p = await getProgressAction(pf);
                  if (p && p.ok && p.progress) {
                    const { done, total, percent } = p.progress as {
                      done: number;
                      total: number;
                      percent: number;
                    };
                    // デバッグ用ログ
                    console.log(
                      `[Progress] done=${done}, total=${total}, percent=${percent}`
                    );
                    // ステータス表示の更新ロジック
                    // ステップ3への遷移はポーリングに依存しない（即時遷移に変更）
                    if (percent >= 100 && currentStep < 4) {
                      // データ読込中（4段階目）
                      setStatusText("[4. データ読込中...]");
                      currentStep = 4;
                    }
                  } else {
                    console.warn(`[Progress] 進捗データ取得失敗:`, p);
                  }
                } catch (e) {
                  console.warn(`[Progress Error]`, e);
                }
              }, 1000) as unknown as number;
            };

            // Server Action開始直後にポーリング開始（初期状態をキャッチ）
            startPolling();
            // 仕訳データ保存の開始後は即ステップ3に遷移（ポーリングに依存しない）
            if (currentStep < 3) {
              setStatusText("[3. AI分類処理中...]");
              currentStep = 3;
            }
            const res = await uploadAndGroupAllAction(fd);
            if (!res || res.ok === false) {
              console.error(res?.error || "アップロード処理に失敗しました");
              toast.error(res?.error || "アップロード処理に失敗しました");
              return;
            }
            console.info(
              "[persist+group] ym=%s imported groups=%d",
              ym,
              ((res as Record<string, unknown>)?.totalGroups as number) ?? 0
            );

            // アップロード後: 単一リクエストで全件取得して即時反映
            setStatusText("[4. データ読込中...]");
            currentStep = 4;

            try {
              const fdAll = new FormData();
              fdAll.set("ym", ym);
              // 取り込み時に全スコープをAI分類済みなので autogroup=false
              fdAll.set("autogroup", "false");
              const all = await getBalanceAllAction(fdAll);
              if (all && all.ok) {
                setAllStore(all);
                const ds = buildDatasetFromAll(
                  all,
                  ym,
                  dept.code,
                  subject.code
                );
                setData(ds);
              }
            } catch (e) {
              console.error("データ読み込みエラー:", e);
              toast.error("データ読み込みに失敗しました");
            }

            setShownYm(ym);
            // 全ての処理が完了したら成功通知を表示
            toast.success("取り込みとAI分類が完了しました");
          } catch (e) {
            console.error(e);
            toast.error("アップロードに失敗しました");
          } finally {
            // ポーリング停止
            try {
              if (timer !== null) window.clearInterval(timer);
            } catch {}
            // ステータスは少しだけ残してから消す
            setTimeout(() => setStatusText(null), 2000);
            setUploading(false);
          }
        }}
      />
      <div className="h-4" />

      <TabRow
        items={departments.map((d) => ({ id: d.code, label: d.name }))}
        activeId={dept.code}
        onChange={(id) => setDept(departments.find((d) => d.code === id)!)}
        ariaLabel="部門タブ"
      />

      <TabRow
        items={subjects.map((s) => ({ id: s.code, label: s.name }))}
        activeId={subject.code}
        onChange={(id) => setSubject(subjects.find((s) => s.code === id)!)}
        ariaLabel="科目タブ"
        size="sm"
      />

      <div className="h-4" />

      <div className="flex justify-end">
        <div className="inline-flex items-center gap-2">
          <Button
            type="button"
            onClick={handlePersist}
            variant="default"
            disabled={
              !shownYm || !hasMatch || projects.length === 0 || !hasChanges
            }
            aria-label="案件・仕訳の入替内容を保存"
            className="shadow-xs hover:bg-primary/90 px-3 py-1.5 h-8 rounded-full"
          >
            保存
          </Button>

          <ExpandAllToggle
            checked={isAllOpen}
            onCheckedChange={(checked) => {
              setExpanded(() =>
                checked
                  ? Object.fromEntries(projects.map((p) => [p.id, true]))
                  : {}
              );
            }}
            disabled={!shownYm || !hasMatch || projects.length === 0}
          />
        </div>
      </div>

      <ProjectsTable
        shownYm={shownYm}
        hasMatch={hasMatch}
        projects={projects}
        expanded={expanded}
        onToggleProject={(id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))}
        onMoveEntry={moveEntry}
        onReorderProjects={reorderProjects}
        onEditProjectName={(id, name) =>
          setProjects((prev) =>
            prev.map((p) => (p.id === id ? { ...p, name } : p))
          )
        }
        onCreateProjectWithEntry={createProjectWithEntry}
        onDeleteProject={deleteProject}
      />
    </main>
  );
}
