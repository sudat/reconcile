"use client";

import { useMemo, useState, Fragment } from "react";
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
import type { Project, Dataset } from "@/types/balance-detail";
import raw from "./sample-data.json";

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
  const carryOver: number = hasMatch ? data.carryOver : 0;
  const projects: Project[] = hasMatch ? data.projects ?? [] : [];

  const monthTotal = carryOver + projects.reduce((s, p) => s + p.total, 0);

  // 一括トグルの状態（全案件が展開されているかどうか）
  const projectIds = projects.map((p) => p.id);
  const isAllOpen =
    projectIds.length > 0 && projectIds.every((id) => expanded[id]);

  // 将来: shownYm に応じてサーバから当該月度データを取得（YAGNIで現状はダミー）

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

      {/* テーブル右上ツールバー（全案件オープン/クローズ） */}
      <div className="flex justify-end">
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

      {/* テーブル（Cardラッパー無し） */}
      <Table className="font-normal">
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">取引先コード</TableHead>
            <TableHead className="whitespace-nowrap">取引先</TableHead>
            <TableHead className="whitespace-nowrap">摘要</TableHead>
            <TableHead className="whitespace-nowrap min-w-[10ch]">
              計上日
            </TableHead>
            <TableHead className="whitespace-nowrap min-w-[12ch]">
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

          {shownYm && (
            <>
              {/* 繰越残高（摘要列に配置） */}
              <TableRow className="bg-muted/30">
                <TableCell />
                <TableCell />
                <TableCell className="font-normal">繰越残高</TableCell>
                <TableCell />
                <TableCell />
                <TableCell />
                <TableCell />
                <TableCell className="text-right tabular-nums">
                  {formatJPY(carryOver)}
                </TableCell>
              </TableRow>

              {/* 案件群 */}
              {!hasMatch && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-6 text-center text-muted-foreground"
                  >
                    この部門・科目のデータは未生成です。ExcelからJSONを生成してください。
                  </TableCell>
                </TableRow>
              )}
            </>
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
              const projectBalance = p.entries.length
                ? p.entries[p.entries.length - 1].balance
                : 0;

              return (
                <Fragment key={p.id}>
                  <TableRow className={projectTone}>
                    {/* 取引先コード */}
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {firstPartnerCode}
                    </TableCell>
                    {/* 取引先（トグルボタンをこのセルに配置） */}
                    <TableCell className="p-0">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
                        onClick={() =>
                          setExpanded((e) => ({ ...e, [p.id]: !e[p.id] }))
                        }
                        aria-expanded={isOpen}
                        aria-label={`${partnerDisplay} の仕訳を${
                          isOpen ? "折りたたむ" : "展開"
                        }`}
                      >
                        <span className="inline-block w-3 text-center">
                          {isOpen ? "▼" : "►"}
                        </span>
                        <span className="truncate block max-w-[28ch] select-none">
                          {partnerDisplay}
                        </span>
                      </button>
                    </TableCell>
                    {/* 摘要（案件名を表示） */}
                    <TableCell>
                      <span className="truncate block max-w-[40ch] select-none">
                        {projectName}
                      </span>
                    </TableCell>
                    {/* 計上日/伝票番号（案件行では空） */}
                    <TableCell />
                    <TableCell />
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
                        <TableRow key={e.id} className={entryTone}>
                          {/* 取引先コード / 取引先 / 摘要 */}
                          <TableCell className="whitespace-nowrap">
                            {e.partnerCode}
                          </TableCell>
                          <TableCell>
                            <span className="truncate block max-w-[28ch]">
                              {e.partnerName}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            <span className="truncate block max-w-[48ch]">
                              {e.memo}
                            </span>
                          </TableCell>
                          {/* 計上日 / 伝票番号 */}
                          <TableCell className="whitespace-nowrap tabular-nums min-w-[10ch]">
                            {formatDateJP(e.date)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
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
    </main>
  );
}
