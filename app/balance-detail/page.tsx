"use client";

import { useMemo, useState, useEffect, useRef, Fragment } from "react";
import {
  DEPARTMENTS,
  type Department,
} from "@/constants/masterdata/departments";
import { SUBJECTS, type Subject } from "@/constants/masterdata/subjects";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HeaderBar } from "@/components/balance-detail/header-bar";
import { TabRow } from "@/components/balance-detail/tab-row";
import { ExpandAllToggle } from "@/components/balance-detail/expand-all-toggle";
import { formatJPY, formatDateJP } from "@/lib/format";
import type { Project, Entry, Dataset } from "@/types/balance-detail";
import raw from "./sample-data.json";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const AUTO_SHOW_LATEST = false; // 初期表示: 最新自動 or 表示待ち（要件検討点）

function currentYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function BalanceDetailPage() {
  // YAGNI/KISS: 固定のダミーデータと軽いUI状態のみ（サーバー処理なし）
  // 部門はマスタ（constants）から参照（DRY/KISS）
  const departments: Department[] = useMemo(() => DEPARTMENTS, []);
  const subjects: Subject[] = useMemo(() => SUBJECTS, []);

  const [dept, setDept] = useState(departments[0]);
  const [subject, setSubject] = useState(subjects[0]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [yearMonth, setYearMonth] = useState<string>(currentYm());
  const [shownYm, setShownYm] = useState<string | null>(
    AUTO_SHOW_LATEST ? currentYm() : null
  );

  const data = raw as Dataset;
  const hasMatch =
    dept.code === data.deptCode && subject.code === data.subjectCode;

  // 画面内編集用に案件配列をstate管理（D&Dや編集、削除に対応）
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    if (shownYm && hasMatch) {
      // データセットから浅いコピーを生成（state直接変更を避ける / KISS）
      setProjects(
        (data.projects ?? []).map((p) => ({ ...p, entries: [...p.entries] }))
      );
    } else {
      setProjects([]);
    }
    // 展開状態はリセットしない（ユーザ操作優先）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownYm, hasMatch]);

  // 当月累計は「案件合計の総和」。繰越は仕様から除外。
  const calcProjectTotal = (p: Project) =>
    p.entries.reduce((s, e) => s + (e.debit - e.credit), 0);
  const monthTotal = projects.reduce((s, p) => s + calcProjectTotal(p), 0);

  // 一括トグルの状態（全案件が展開されているかどうか）
  const projectIds = projects.map((p) => p.id);
  const isAllOpen =
    projectIds.length > 0 && projectIds.every((id) => expanded[id]);

  // D&D/コンテキストメニュー用の一時状態
  type DragState =
    | { type: "entry"; entryId: string; fromProjectId: string }
    | { type: "project"; projectId: string };
  const dragRef = useRef<DragState | null>(null);

  const [ctxMenu, setCtxMenu] = useState<
    | null
    | (
        | {
            type: "entry";
            entryId: string;
            fromProjectId: string;
            x: number;
            y: number;
          }
        | { type: "project"; projectId: string; x: number; y: number }
      )
  >(null);

  const closeCtx = () => setCtxMenu(null);

  const byId = (id: string) => projects.find((p) => p.id === id);

  // 案件名インライン編集
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(
    null
  );

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
    const partner = e.partnerName?.trim() || "取引先未設定";
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

  // 将来: shownYm に応じてサーバから当該月度データを取得（YAGNIで現状はダミー）

  // 永続化（ダミー）: 将来 Server Action/API に置換。YAGNI/KISS でいまは空実装。
  const handlePersist = () => {
    // TODO: サーバ実装時に projects / dept / subject / shownYm を送信
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
          // 将来: Server Action 経由でファイル取り込み＋月度スコープ指定
          // いまはコンソールに通知のみ（YAGNI）
          console.info("[upload] ym=%s file=%s", ym, file?.name);
        }}
      />
      <div className="h-4" />

      {/* 上位: 部門タブ */}
      <TabRow
        items={departments.map((d) => ({ id: d.code, label: d.name }))}
        activeId={dept.code}
        onChange={(id) => setDept(departments.find((d) => d.code === id)!)}
        ariaLabel="部門タブ"
      />

      {/* 下位: 科目タブ（左端を上位タブと揃える） */}
      <TabRow
        items={subjects.map((s) => ({ id: s.code, label: s.name }))}
        activeId={subject.code}
        onChange={(id) => setSubject(subjects.find((s) => s.code === id)!)}
        ariaLabel="科目タブ"
        size="sm"
      />

      <div className="h-4" />

      {/* テーブル右上ツールバー（保存 + 全案件オープン/クローズ） */}
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

      {/* テーブル（Cardラッパー無し） */}
      <Table className="font-normal table-fixed">
        {/* 列幅固定（table-fixed）: 8列 */}
        <colgroup>
          {/* 取引先コード */}
          <col className="w-[100px]" />
          {/* 取引先 */}
          <col className="w-[120px]" />
          {/* 摘要 */}
          <col className="sm:w-[120px] md:w-[180px] lg:w-[240px]" />
          {/* 計上日（96px固定） */}
          <col className="w-24" />
          {/* 伝票番号（96px固定） */}
          <col className="w-24" />
          {/* 借方/貸方/残高 */}
          <col className="w-[120px]" />
          <col className="w-[120px]" />
          <col className="w-[120px]" />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">取引先</TableHead>
            <TableHead className="whitespace-nowrap">取引先名</TableHead>
            <TableHead className="whitespace-nowrap">
              案件名／仕訳摘要
            </TableHead>
            <TableHead className="whitespace-nowrap w-24 truncate">
              計上日
            </TableHead>
            <TableHead className="whitespace-nowrap w-24 truncate">
              伝票番号
            </TableHead>
            <TableHead className="text-right whitespace-nowrap">借方</TableHead>
            <TableHead className="text-right whitespace-nowrap">貸方</TableHead>
            <TableHead className="text-right whitespace-nowrap">残高</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* 未選択時の空状態 */}
          {!shownYm && (
            <TableRow>
              <TableCell
                colSpan={8}
                className="py-8 text-center text-muted-foreground"
              >
                対象年月を選択し「表示」を押してください。
              </TableCell>
            </TableRow>
          )}

          {shownYm && !hasMatch && (
            <TableRow>
              <TableCell
                colSpan={8}
                className="py-6 text-center text-muted-foreground"
              >
                この部門・科目のデータは未生成です。ExcelからJSONを生成してください。
              </TableCell>
            </TableRow>
          )}

          {shownYm &&
            projects.map((p) => {
              const isOpen = expanded[p.id];
              const isPrevProject =
                p.entries.length > 0 &&
                p.entries.every((e) => e.month === "prev");
              // 案件行の配色: bg-secondary-foreground を淡色で活用（派手すぎないトーン）
              // - 前月のみの案件: より暗色 `bg-secondary-foreground/10`
              // - 当月に動きがある案件: `bg-secondary-foreground/5`
              // Hover 時は段階的に濃くして視認性を確保
              const projectTone = isPrevProject
                ? "bg-secondary-foreground/10 hover:bg-secondary-foreground/20"
                : "bg-secondary-foreground/5 hover:bg-secondary-foreground/10";
              const firstPartner =
                p.entries.find((e) => e.partnerName)?.partnerName?.trim() || "";
              const firstPartnerCode =
                p.entries.find((e) => e.partnerCode)?.partnerCode?.trim() || "";
              const projectNameRaw = p.name?.trim() || "";
              const projectName =
                projectNameRaw && projectNameRaw !== firstPartner
                  ? projectNameRaw
                  : "案件名未設定";
              const partnerDisplay = firstPartner || "取引先未設定";
              const projectBalance = calcProjectTotal(p);

              return (
                <Fragment key={p.id}>
                  <TableRow
                    className={projectTone + " cursor-pointer"}
                    onClick={(ev) => {
                      const t = ev.target as HTMLElement;
                      // テキスト選択中やハンドル等の操作中はトグルしない
                      if (window.getSelection()?.toString()) return;
                      if (t.closest("[data-no-row-toggle]")) return;
                      setExpanded((e) => ({ ...e, [p.id]: !e[p.id] }));
                    }}
                    onDragOver={(ev) => {
                      const d = dragRef.current;
                      if (!d) return;
                      // 案件行へのドロップ受け入れ（仕訳/案件いずれも）
                      ev.preventDefault();
                    }}
                    onDrop={(ev) => {
                      const d = dragRef.current;
                      dragRef.current = null;
                      if (!d) return;
                      const rect = (
                        ev.currentTarget as HTMLElement
                      ).getBoundingClientRect();
                      const place: "before" | "after" =
                        ev.clientY < rect.top + rect.height / 2
                          ? "before"
                          : "after";
                      if (d.type === "entry") {
                        moveEntry(d.entryId, d.fromProjectId, p.id);
                      } else if (d.type === "project") {
                        reorderProjects(d.projectId, p.id, place);
                      }
                    }}
                    onContextMenu={(ev) => {
                      ev.preventDefault();
                      setCtxMenu({
                        type: "project",
                        projectId: p.id,
                        x: ev.clientX,
                        y: ev.clientY,
                      });
                    }}
                  >
                    {/* 取引先コード + 並び替えハンドル */}
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      <span
                        role="button"
                        aria-label="案件の並び替えハンドル"
                        title="ドラッグで案件の順序を変更"
                        data-no-row-toggle
                        className="mr-1 cursor-grab select-none text-muted-foreground/70 hover:text-foreground"
                        draggable
                        onDragStart={(ev) => {
                          dragRef.current = {
                            type: "project",
                            projectId: p.id,
                          };
                          ev.dataTransfer.setData(
                            "text/plain",
                            `project:${p.id}`
                          );
                        }}
                        onDragEnd={() => (dragRef.current = null)}
                      >
                        ≡
                      </span>
                      {firstPartnerCode}
                    </TableCell>
                    {/* 取引先名（案件行はツールチップ無し） */}
                    <TableCell className="p-0">
                      <span className="block px-2 py-1.5 text-left truncate max-w-[28ch]">
                        {partnerDisplay}
                      </span>
                    </TableCell>
                    {/* 摘要（案件名を表示） */}
                    <TableCell
                      onDoubleClick={() =>
                        setEditing({
                          id: p.id,
                          name:
                            projectName === "案件名未設定" ? "" : projectName,
                        })
                      }
                    >
                      {editing?.id === p.id ? (
                        <input
                          data-no-row-toggle
                          autoFocus
                          value={editing.name}
                          onChange={(e) => {
                            const v = (e.currentTarget as HTMLInputElement)
                              .value;
                            setEditing((s) => (s ? { ...s, name: v } : s));
                          }}
                          onBlur={() => {
                            if (!editing) return;
                            setProjects((prev) =>
                              prev.map((q) =>
                                q.id === p.id
                                  ? { ...q, name: editing.name || q.name }
                                  : q
                              )
                            );
                            setEditing(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              (e.currentTarget as HTMLInputElement).blur();
                            } else if (e.key === "Escape") {
                              setEditing(null);
                            }
                          }}
                          className="w-full bg-background border rounded px-2 py-1 text-sm"
                        />
                      ) : (
                        <span className="truncate block max-w-[40ch]">
                          {projectName}
                        </span>
                      )}
                    </TableCell>
                    {/* 計上日/伝票番号（案件行では空） */}
                    <TableCell className="w-24" />
                    <TableCell className="w-24" />
                    {/* 借方合計 / 貸方合計 */}
                    <TableCell className="text-right tabular-nums">
                      {formatJPY(p.entries.reduce((s, e) => s + e.debit, 0))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatJPY(p.entries.reduce((s, e) => s + e.credit, 0))}
                    </TableCell>
                    {/* 残高（案件行のみ表示） */}
                    <TableCell className="text-right tabular-nums">
                      {formatJPY(projectBalance)}
                    </TableCell>
                  </TableRow>
                  {/* 明細: 同一テーブル内に直接描画（列幅を完全に共有） */}
                  {isOpen &&
                    p.entries.map((e) => {
                      const entryTone = e.month === "prev" ? "bg-muted/20" : "";
                      return (
                        <TableRow
                          key={e.id}
                          className={entryTone}
                          onDragOver={(ev) => {
                            // 仕訳行上でもドロップ可能（同一案件扱い）
                            if (dragRef.current) ev.preventDefault();
                          }}
                          onDrop={() => {
                            const d = dragRef.current;
                            dragRef.current = null;
                            if (!d) return;
                            if (d.type === "entry")
                              moveEntry(d.entryId, d.fromProjectId, p.id);
                            if (d.type === "project")
                              reorderProjects(d.projectId, p.id, "before");
                          }}
                          onContextMenu={(ev) => {
                            ev.preventDefault();
                            setCtxMenu({
                              type: "entry",
                              entryId: e.id,
                              fromProjectId: p.id,
                              x: ev.clientX,
                              y: ev.clientY,
                            });
                          }}
                        >
                          {/* 取引先コード / 並び替えハンドル */}
                          <TableCell className="whitespace-nowrap">
                            <span
                              role="button"
                              aria-label="仕訳の移動ハンドル"
                              title="ドラッグで仕訳を案件間移動"
                              data-no-row-toggle
                              className="mr-1 cursor-grab select-none text-muted-foreground/70 hover:text-foreground"
                              draggable
                              onDragStart={(ev) => {
                                dragRef.current = {
                                  type: "entry",
                                  entryId: e.id,
                                  fromProjectId: p.id,
                                };
                                ev.dataTransfer.setData(
                                  "text/plain",
                                  `entry:${e.id}`
                                );
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
                                <span className="truncate block max-w-[28ch]">
                                  {e.partnerName}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                align="start"
                                className="max-w-[640px] break-words"
                              >
                                {e.partnerName}
                              </TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="truncate block max-w-[48ch]">
                                  {e.memo}
                                </span>
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
                          {/* 計上日 / 伝票番号 */}
                          <TableCell className="w-24 tabular-nums truncate">
                            {formatDateJP(e.date)}
                          </TableCell>
                          <TableCell className="w-24 truncate">
                            {e.voucherNo}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatJPY(e.debit)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatJPY(e.credit)}
                          </TableCell>
                          {/* 残高は明細では非表示 */}
                          <TableCell />
                        </TableRow>
                      );
                    })}
                </Fragment>
              );
            })}

          {/* 当月累計（摘要列に配置） */}
          {shownYm && (
            <TableRow className="bg-muted/30">
              <TableCell />
              <TableCell />
              <TableCell className="font-normal">当月累計</TableCell>
              <TableCell />
              <TableCell />
              <TableCell className="text-right tabular-nums">
                {formatJPY(
                  projects
                    .flatMap((p) => p.entries)
                    .reduce((s, e) => s + e.debit, 0)
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatJPY(
                  projects
                    .flatMap((p) => p.entries)
                    .reduce((s, e) => s + e.credit, 0)
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatJPY(monthTotal)}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* 右クリックメニュー（簡易実装 / KISS） */}
      {ctxMenu && (
        <div
          className="fixed inset-0 z-50"
          onClick={closeCtx}
          onContextMenu={(e) => {
            e.preventDefault();
            closeCtx();
          }}
        >
          <div
            className="absolute min-w-40 rounded-md border bg-popover p-1 shadow-md"
            style={{ left: ctxMenu.x + 4, top: ctxMenu.y + 4 }}
            role="menu"
          >
            {ctxMenu.type === "entry" ? (
              <button
                className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-accent"
                onClick={() => {
                  const src = byId(ctxMenu.fromProjectId);
                  const entry = src?.entries.find(
                    (x) => x.id === ctxMenu.entryId
                  );
                  if (entry)
                    createProjectWithEntry(entry, ctxMenu.fromProjectId);
                  closeCtx();
                }}
              >
                この仕訳から新規案件を作成
              </button>
            ) : (
              <>
                <button
                  className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-accent"
                  onClick={() => {
                    // 仕訳が残っている場合は未分類に退避してから削除
                    const pid = ctxMenu.projectId;
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
                    closeCtx();
                  }}
                >
                  案件を削除（仕訳は未分類へ移動）
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
