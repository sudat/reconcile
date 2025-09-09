"use client";

import { useEffect, useMemo, useState } from "react";
import { DEPARTMENTS, type Department } from "@/constants/masterdata/departments";
import { SUBJECTS, type Subject } from "@/constants/masterdata/subjects";
import { HeaderBar } from "@/components/balance-detail/header-bar";
import { TabRow } from "@/components/balance-detail/tab-row";
import { ExpandAllToggle } from "@/components/balance-detail/expand-all-toggle";
import type { Dataset, Entry, Project } from "@/types/balance-detail";
import raw from "./sample-data.json";
import { Button } from "@/components/ui/button";
import { ProjectsTable } from "@/components/balance-detail/projects-table";

const AUTO_SHOW_LATEST = false; // 初期表示: 最新自動 or 表示待ち（要件検討点）

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
  const [shownYm, setShownYm] = useState<string | null>(AUTO_SHOW_LATEST ? currentYm() : null);

  const data = raw as Dataset;
  const hasMatch = dept.code === data.deptCode && subject.code === data.subjectCode;

  // 画面内編集用に案件配列をstate管理（D&Dや編集、削除に対応）
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    if (shownYm && hasMatch) {
      // データセットから浅いコピーを生成（state直接変更を避ける / KISS）
      setProjects((data.projects ?? []).map((p) => ({ ...p, entries: [...p.entries] })));
    } else {
      setProjects([]);
    }
    // 展開状態はリセットしない（ユーザ操作優先）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownYm, hasMatch]);

  // 一括トグルの状態
  const projectIds = projects.map((p) => p.id);
  const isAllOpen = projectIds.length > 0 && projectIds.every((id) => expanded[id]);

  const moveEntry = (entryId: string, fromId: string, toId: string) => {
    if (fromId === toId) return;
    setProjects((prev) => {
      const src = prev.find((p) => p.id === fromId);
      const dst = prev.find((p) => p.id === toId);
      if (!src || !dst) return prev;
      const entryIndex = src.entries.findIndex((e) => e.id === entryId);
      if (entryIndex < 0) return prev;
      const entry = src.entries[entryIndex];
      const newSrc: Project = { ...src, entries: src.entries.filter((e) => e.id !== entryId) };
      const newDst: Project = { ...dst, entries: [...dst.entries, entry] };
      const next = prev.map((p) => (p.id === src.id ? newSrc : p.id === dst.id ? newDst : p));
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
      const insertIndex = place === "before" ? (from < to ? to - 1 : to) : from < to ? to : to + 1;
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
      const newSrc: Project = { ...prev[srcIdx], entries: prev[srcIdx].entries.filter((x) => x.id !== e.id) };
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
      return rest.map((p) => (p.id === miscId ? { ...p, entries: [...p.entries, ...target.entries] } : p));
    });
  };

  // 永続化（ダミー）
  const handlePersist = () => {
    console.info(
      "[persist] ym=%s dept=%s subject=%s projects=%d",
      shownYm,
      dept.code,
      subject.code,
      projects.length
    );
  };

  return (
    <main className="container mx-auto font-normal max-w-7xl">
      <div className="text-2xl font-bold mb-4  pb-2">残高明細</div>
      <HeaderBar
        yearMonth={yearMonth}
        onYearMonthChange={setYearMonth}
        onShow={() => setShownYm(yearMonth)}
        onUploadFile={(file, ym) => {
          console.info("[upload] ym=%s file=%s", ym, file?.name);
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
            disabled={!shownYm || !hasMatch || projects.length === 0}
            aria-label="案件・仕訳の入替内容を保存"
            className="shadow-xs hover:bg-primary/90 px-3 py-1.5 h-8 rounded-full"
          >
            保存
          </Button>

          <ExpandAllToggle
            checked={isAllOpen}
            onCheckedChange={(checked) => {
              setExpanded(() => (checked ? Object.fromEntries(projects.map((p) => [p.id, true])) : {}));
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
        onEditProjectName={(id, name) => setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)))}
        onCreateProjectWithEntry={createProjectWithEntry}
        onDeleteProject={deleteProject}
      />
    </main>
  );
}

