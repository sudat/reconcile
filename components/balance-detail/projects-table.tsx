"use client";

import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateJP, formatJPY } from "@/lib/format";
import type { Entry, Project } from "@/types/balance-detail";
import { ContextMenuOverlay } from "./context-menu";

type DragState =
  | { type: "entry"; entryId: string; fromProjectId: string }
  | { type: "project"; projectId: string };

type CtxState =
  | null
  | (
      | { type: "entry"; entryId: string; fromProjectId: string; x: number; y: number }
      | { type: "project"; projectId: string; x: number; y: number }
    );

type SortConfig = {
  column: 'partnerCode' | 'partnerName' | 'projectName' | 'debit' | 'credit' | 'balance';
  direction: 'asc' | 'desc';
} | null;

export function ProjectsTable({
  shownYm,
  hasMatch,
  projects,
  expanded,
  onToggleProject,
  onMoveEntry,
  onReorderProjects,
  onEditProjectName,
  onCreateProjectWithEntry,
  onDeleteProject,
}: {
  shownYm: string | null;
  hasMatch: boolean;
  projects: Project[];
  expanded: Record<string, boolean>;
  onToggleProject: (projectId: string) => void;
  onMoveEntry: (entryId: string, fromProjectId: string, toProjectId: string) => void;
  onReorderProjects: (dragId: string, overId: string, place: "before" | "after") => void;
  onEditProjectName: (projectId: string, name: string) => void;
  onCreateProjectWithEntry: (entry: Entry, fromProjectId: string) => void;
  onDeleteProject: (projectId: string) => void;
}) {
  const dragRef = useRef<DragState | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxState>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);

  const calcProjectTotal = useCallback((p: Project) => p.entries.reduce((s, e) => s + (e.debit - e.credit), 0), []);
  const monthTotal = useMemo(
    () => projects.reduce((s, p) => s + calcProjectTotal(p), 0),
    [projects, calcProjectTotal]
  );

  const handleSort = (column: NonNullable<SortConfig>['column']) => {
    const direction = 
      sortConfig?.column === column && sortConfig.direction === 'asc' 
        ? 'desc' 
        : 'asc';
    
    setSortConfig({ column, direction });
  };

  const getSortIcon = (column: NonNullable<SortConfig>['column']) => {
    if (sortConfig?.column !== column) {
      return <span className="text-muted-foreground/50">▽</span>;
    }
    return sortConfig.direction === 'asc' 
      ? <span className="text-foreground">▲</span>
      : <span className="text-foreground">▼</span>;
  };

  const sortedProjects = useMemo(() => {
    if (!sortConfig) return projects;

    return [...projects].sort((a, b) => {
      const { column, direction } = sortConfig;
      let aValue: string | number;
      let bValue: string | number;

      // 各プロジェクトの比較値を取得
      switch (column) {
        case 'partnerCode':
          aValue = a.entries.find((e) => e.partnerCode)?.partnerCode?.trim() || '';
          bValue = b.entries.find((e) => e.partnerCode)?.partnerCode?.trim() || '';
          break;
        case 'partnerName':
          aValue = a.entries.find((e) => e.partnerName)?.partnerName?.trim() || '';
          bValue = b.entries.find((e) => e.partnerName)?.partnerName?.trim() || '';
          break;
        case 'projectName':
          aValue = a.name?.trim() || '';
          bValue = b.name?.trim() || '';
          break;
        case 'debit':
          aValue = a.entries.reduce((s, e) => s + e.debit, 0);
          bValue = b.entries.reduce((s, e) => s + e.debit, 0);
          break;
        case 'credit':
          aValue = a.entries.reduce((s, e) => s + e.credit, 0);
          bValue = b.entries.reduce((s, e) => s + e.credit, 0);
          break;
        case 'balance':
          aValue = calcProjectTotal(a);
          bValue = calcProjectTotal(b);
          break;
        default:
          return 0;
      }

      // 文字列と数値の比較
      let comparison = 0;
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        comparison = aValue.localeCompare(bValue, 'ja');
      } else {
        comparison = (aValue as number) - (bValue as number);
      }

      return direction === 'asc' ? comparison : -comparison;
    });
  }, [projects, sortConfig, calcProjectTotal]);

  return (
    <>
      <Table className="font-normal table-fixed">
        <colgroup>
          <col className="w-[100px]" />
          <col className="w-[120px]" />
          <col className="sm:w-[120px] md:w-[180px] lg:w-[240px]" />
          <col className="w-24" />
          <col className="w-24" />
          <col className="w-[120px]" />
          <col className="w-[120px]" />
          <col className="w-[120px]" />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead 
              className="whitespace-nowrap cursor-pointer hover:bg-muted/50 select-none"
              onClick={() => handleSort('partnerCode')}
            >
              <div className="flex items-center gap-1">
                取引先
                {getSortIcon('partnerCode')}
              </div>
            </TableHead>
            <TableHead 
              className="whitespace-nowrap cursor-pointer hover:bg-muted/50 select-none"
              onClick={() => handleSort('partnerName')}
            >
              <div className="flex items-center gap-1">
                取引先名
                {getSortIcon('partnerName')}
              </div>
            </TableHead>
            <TableHead 
              className="whitespace-nowrap cursor-pointer hover:bg-muted/50 select-none"
              onClick={() => handleSort('projectName')}
            >
              <div className="flex items-center gap-1">
                案件名／仕訳摘要
                {getSortIcon('projectName')}
              </div>
            </TableHead>
            <TableHead className="whitespace-nowrap w-24 truncate">計上日</TableHead>
            <TableHead className="whitespace-nowrap w-24 truncate">伝票番号</TableHead>
            <TableHead 
              className="text-right whitespace-nowrap cursor-pointer hover:bg-muted/50 select-none"
              onClick={() => handleSort('debit')}
            >
              <div className="flex items-center justify-end gap-1">
                借方
                {getSortIcon('debit')}
              </div>
            </TableHead>
            <TableHead 
              className="text-right whitespace-nowrap cursor-pointer hover:bg-muted/50 select-none"
              onClick={() => handleSort('credit')}
            >
              <div className="flex items-center justify-end gap-1">
                貸方
                {getSortIcon('credit')}
              </div>
            </TableHead>
            <TableHead 
              className="text-right whitespace-nowrap cursor-pointer hover:bg-muted/50 select-none"
              onClick={() => handleSort('balance')}
            >
              <div className="flex items-center justify-end gap-1">
                残高
                {getSortIcon('balance')}
              </div>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!shownYm && (
            <TableRow>
              <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                対象年月を選択し「表示」を押してください。
              </TableCell>
            </TableRow>
          )}

          {shownYm && !hasMatch && (
            <TableRow>
              <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                この部門・科目のデータは未生成です。ExcelからJSONを生成してください。
              </TableCell>
            </TableRow>
          )}

          {shownYm &&
            sortedProjects.map((p) => {
              const isOpen = expanded[p.id];
              const isPrevProject = p.entries.length > 0 && p.entries.every((e) => e.month === "prev");
              const projectTone = isPrevProject
                ? "bg-secondary-foreground/10 hover:bg-secondary-foreground/20"
                : "bg-secondary-foreground/5 hover:bg-secondary-foreground/10";
              const firstPartner = p.entries.find((e) => e.partnerName)?.partnerName?.trim() || "";
              const firstPartnerCode = p.entries.find((e) => e.partnerCode)?.partnerCode?.trim() || "";
              const projectNameRaw = p.name?.trim() || "";
              const projectName = projectNameRaw && projectNameRaw !== firstPartner ? projectNameRaw : "案件名未設定";
              const partnerDisplay = firstPartner || "取引先未設定";
              const projectBalance = calcProjectTotal(p);

              return (
                <Fragment key={p.id}>
                  <TableRow
                    className={projectTone + " cursor-pointer"}
                    onClick={(ev) => {
                      const t = ev.target as HTMLElement;
                      if (window.getSelection()?.toString()) return;
                      if (t.closest("[data-no-row-toggle]")) return;
                      onToggleProject(p.id);
                    }}
                    onDragOver={(ev) => {
                      const d = dragRef.current;
                      if (!d) return;
                      ev.preventDefault();
                    }}
                    onDrop={(ev) => {
                      const d = dragRef.current;
                      dragRef.current = null;
                      if (!d) return;
                      const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                      const place: "before" | "after" = ev.clientY < rect.top + rect.height / 2 ? "before" : "after";
                      if (d.type === "entry") onMoveEntry(d.entryId, d.fromProjectId, p.id);
                      else if (d.type === "project") onReorderProjects(d.projectId, p.id, place);
                    }}
                    onContextMenu={(ev) => {
                      ev.preventDefault();
                      setCtxMenu({ type: "project", projectId: p.id, x: ev.clientX, y: ev.clientY });
                    }}
                  >
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      <span
                        role="button"
                        aria-label="案件の並び替えハンドル"
                        title="ドラッグで案件の順序を変更"
                        data-no-row-toggle
                        className="mr-1 cursor-grab select-none text-muted-foreground/70 hover:text-foreground"
                        draggable
                        onDragStart={(ev) => {
                          dragRef.current = { type: "project", projectId: p.id };
                          ev.dataTransfer.setData("text/plain", `project:${p.id}`);
                        }}
                        onDragEnd={() => (dragRef.current = null)}
                      >
                        ≡
                      </span>
                      {firstPartnerCode}
                    </TableCell>
                    <TableCell className="p-0">
                      <span className="block px-2 py-1.5 text-left truncate max-w-[28ch]">{partnerDisplay}</span>
                    </TableCell>
                    <TableCell
                      onDoubleClick={() => setEditing({ id: p.id, name: projectName === "案件名未設定" ? "" : projectName })}
                    >
                      {editing?.id === p.id ? (
                        <input
                          data-no-row-toggle
                          autoFocus
                          value={editing.name}
                          // Reactのイベントはタイミングにより currentTarget が null になることがあるため
                          // 先に値を退避してから setState へ渡す（KISS/DRY）。
                          onChange={(e) => {
                            const value = (e.currentTarget as HTMLInputElement).value;
                            setEditing((s) => (s ? { ...s, name: value } : s));
                          }}
                          onBlur={() => {
                            if (!editing) return;
                            onEditProjectName(p.id, editing.name || p.name);
                            setEditing(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                            else if (e.key === "Escape") setEditing(null);
                          }}
                          className="w-full bg-background border rounded px-2 py-1 text-sm"
                        />
                      ) : (
                        <span className="truncate block max-w-[40ch]">{projectName}</span>
                      )}
                    </TableCell>
                    <TableCell className="w-24" />
                    <TableCell className="w-24" />
                    <TableCell className="text-right tabular-nums">
                      {formatJPY(p.entries.reduce((s, e) => s + e.debit, 0))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatJPY(p.entries.reduce((s, e) => s + e.credit, 0))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatJPY(projectBalance)}</TableCell>
                  </TableRow>

                  {isOpen &&
                    p.entries.map((e) => {
                      const entryTone = e.month === "prev" ? "bg-muted/20" : "";
                      return (
                        <TableRow
                          key={e.id}
                          className={entryTone}
                          onDragOver={(ev) => {
                            if (dragRef.current) ev.preventDefault();
                          }}
                          onDrop={() => {
                            const d = dragRef.current;
                            dragRef.current = null;
                            if (!d) return;
                            if (d.type === "entry") onMoveEntry(d.entryId, d.fromProjectId, p.id);
                            if (d.type === "project") onReorderProjects(d.projectId, p.id, "before");
                          }}
                          onContextMenu={(ev) => {
                            ev.preventDefault();
                            setCtxMenu({ type: "entry", entryId: e.id, fromProjectId: p.id, x: ev.clientX, y: ev.clientY });
                          }}
                        >
                          <TableCell className="whitespace-nowrap">
                            <span
                              role="button"
                              aria-label="仕訳の移動ハンドル"
                              title="ドラッグで仕訳を案件間移動"
                              data-no-row-toggle
                              className="mr-1 cursor-grab select-none text-muted-foreground/70 hover:text-foreground"
                              draggable
                              onDragStart={(ev) => {
                                dragRef.current = { type: "entry", entryId: e.id, fromProjectId: p.id };
                                ev.dataTransfer.setData("text/plain", `entry:${e.id}`);
                              }}
                              onDragEnd={() => (dragRef.current = null)}
                            >
                              ≡
                            </span>
                            {e.partnerCode}
                          </TableCell>
                          <TableCell>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="truncate block max-w-[28ch]">{e.partnerName}</span>
                              </TooltipTrigger>
                              <TooltipContent side="top" align="start" className="max-w-[640px] break-words">
                                {e.partnerName}
                              </TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="truncate block max-w-[48ch]">{e.memo}</span>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                align="start"
                                className="max-w-[640px] break-words whitespace-pre-wrap"
                              >
                                {e.memo}
                              </TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell className="w-24 tabular-nums truncate">{formatDateJP(e.date)}</TableCell>
                          <TableCell className="w-24 truncate">{e.voucherNo}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatJPY(e.debit)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatJPY(e.credit)}</TableCell>
                          <TableCell />
                        </TableRow>
                      );
                    })}
                </Fragment>
              );
            })}

          {shownYm && (
            <TableRow className="bg-muted/30">
              <TableCell />
              <TableCell />
              <TableCell className="font-normal">当月累計</TableCell>
              <TableCell />
              <TableCell />
              <TableCell className="text-right tabular-nums">
                {formatJPY(projects.flatMap((p) => p.entries).reduce((s, e) => s + e.debit, 0))}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatJPY(projects.flatMap((p) => p.entries).reduce((s, e) => s + e.credit, 0))}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatJPY(monthTotal)}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {ctxMenu && (
        <ContextMenuOverlay
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={
            ctxMenu.type === "entry"
              ? [
                  {
                    key: "new-project",
                    label: "この仕訳から新規案件を作成",
                    onClick: () => {
                      const src = projects.find((pp) => pp.id === ctxMenu.fromProjectId);
                      const entry = src?.entries.find((x) => x.id === ctxMenu.entryId);
                      if (entry) onCreateProjectWithEntry(entry, ctxMenu.fromProjectId);
                      setCtxMenu(null);
                    },
                  },
                ]
              : [
                  {
                    key: "delete-project",
                    label: "案件を削除（仕訳は未分類へ移動）",
                    onClick: () => {
                      onDeleteProject(ctxMenu.projectId);
                      setCtxMenu(null);
                    },
                  },
                ]
          }
        />
      )}
    </>
  );
}
