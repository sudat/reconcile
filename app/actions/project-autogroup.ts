"use server";
import { prisma } from "@/lib/prisma";
import { waitNeonReady } from "@/lib/neon";
import OpenAI from "openai";
import { AI_GROUPING } from "@/constants/ai";
import { randomUUID } from "crypto";
import {
  withWorkflowTrace,
  withSpan,
  withResponseTracing,
} from "@/lib/tracing";
import { logWorkflow } from "@/lib/logger";

function n(x: bigint | number | null | undefined): number {
  if (x == null) return 0;
  return Number(x);
}

function normalize(s: string) {
  // ユニコード正規化と記号・空白の統一（厳密一致の取りこぼしを減らす）
  return s
    .normalize("NFKC")
    .replace(/[\u3000\s]+/g, " ") // 全角スペース含む空白を単一半角スペースへ
    .replace(/[〜~～]/g, "〜") // 波ダッシュ等の表記ゆれを統一
    .replace(/[()（）]/g, (c) => (c === "（" || c === "(" ? "(" : ")"))
    .trim();
}

function splitMemos(s: string): string[] {
  // AI出力が「;」や改行で複数摘要を連結して返るケースに対応
  // 和文句読点や全角セミコロンも許容
  return s
    .split(/[;；、，\n]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

// 月次・期間などの具体情報を捨象してラベルを正規化
// ルールベースの捨象は行わない（要件）。

type AutoGroupResult = {
  created: number;
  projects: { id: string; name: string; total: number }[];
};

/**
 * 取引先×摘要で案件を自動生成（初回のみ）。
 * - 既にプロジェクトが存在する場合は何もしない（force指定時を除く）。
 * - Heuristicで分類し、残りはOpenAI(gpt-4o-mini)に要約ラベルを依頼。
 */
export async function ensureAutoGrouping(
  form: FormData
): Promise<{ ok: boolean; error?: string; result?: AutoGroupResult }> {
  await waitNeonReady("auto-group");
  const ym = String(form.get("ym") || "");
  const deptCode = String(form.get("deptCode") || "");
  const subjectCode = String(form.get("subjectCode") || "");
  const workflowId = String(form.get("workflowId") || "");
  const force = String(form.get("force") || "false").toLowerCase() === "true";
  if (!ym || !deptCode || !subjectCode)
    return { ok: false, error: "パラメータが不足しています" };

  const ds = await prisma.dataset.findUnique({
    where: { deptCode_subjectCode_ym: { deptCode, subjectCode, ym } },
  });
  if (!ds) return { ok: false, error: "該当データセットが存在しません" };

  const existingCount = await prisma.project.count({
    where: { datasetId: ds.id, isDeleted: false },
  });
  if (existingCount > 0 && !force)
    return { ok: true, result: { created: 0, projects: [] } };

  const entries = await prisma.entry.findMany({
    where: { datasetId: ds.id, softDeletedAt: null },
    orderBy: [{ date: "asc" }, { voucherNo: "asc" }],
    select: {
      id: true,
      memo: true,
      partnerName: true,
      partnerCode: true,
      debit: true,
      credit: true,
    },
  });

  // 取引先ごとに摘要をAIでラベリング（ヒューリスティックは使用しない）
  type Key = string; // partnerCode|label
  const groups = new Map<Key, { name: string; ids: string[]; total: number }>();
  const memosByPartner = new Map<string, Set<string>>();
  const nameByPartner = new Map<string, string>();
  const entriesByPartner = new Map<string, typeof entries>();

  for (const e of entries) {
    const set = memosByPartner.get(e.partnerCode) ?? new Set<string>();
    set.add(normalize(e.memo));
    memosByPartner.set(e.partnerCode, set);
    if (e.partnerName) nameByPartner.set(e.partnerCode, e.partnerName);
    const list = entriesByPartner.get(e.partnerCode) ?? [];
    list.push(e);
    entriesByPartner.set(e.partnerCode, list);
  }

  const apiKey =
    process.env.OPENAI_API_KEY ||
    (process.env as Record<string, string | undefined>).OPEN_API_KEY;
  if (apiKey) {
    const client = new OpenAI({ apiKey });

    type PartnerTask = {
      partnerCode: string;
      memos: string[];
      partnerName: string;
    };
    const partnerTasks: PartnerTask[] = Array.from(
      memosByPartner.entries()
    ).map(([code, set]) => ({
      partnerCode: code,
      memos: Array.from(set),
      partnerName: nameByPartner.get(code) || code,
    }));

    // スコープ単位で1回のAI呼び出し（取引先配列を入力）
    const partnerResults = await withSpan(
      { name: "autogroup", metadata: { ym, deptCode, subjectCode } },
      async () => {
        // 日本語化: 自動グループ化の開始
        logWorkflow(
          workflowId,
          `自動グループ化開始: 部門=${deptCode}, 科目=${subjectCode}`
        );
        const abstr = Math.max(0, Math.min(1, AI_GROUPING.abstraction));
        const guide =
          abstr >= 0.8
            ? `可能な限り一般名詞へ統一（例: "電気代"/"水道代"/"ガス代"/"クレジット手数料"/"振替"/"返金" など）。半年間や1年間使い続けられる簡潔な名称が良い。逆に月/期間/回数/枝番等の枝葉末節の情報は不要。例：月=8月度、期間=8/1~8/15、回数=3回目などが不要。`
            : abstr >= 0.5
            ? `月/期間/回数/枝番などの補助情報は省略し、要点語を残す（例: "電気代", "水道代", "クレジット手数料(セゾン)"）。`
            : `摘要の表現をできるだけ保持しつつ、末尾のノイズ（全角括弧の注記など）は省略。`;
        const MAX = Math.max(10, Math.min(500, AI_GROUPING.maxMemosPerPartner));

        const payload = partnerTasks.map((p) => ({
          partnerCode: p.partnerCode,
          partnerName: p.partnerName,
          memos: p.memos, // トークン余裕前提で全件投入
        }));

        const prompt = `あなたは会計データのアシスタントです。次の部門×勘定科目の取引先ごとの摘要リストを、案件名（短いラベル）に統合してください。\n- グループ化方針（抽象化強度=${abstr.toFixed(
          2
        )}）: ${guide}\n- ラベルは10〜30文字程度の日本語。括弧は最小限に使用。\n- 出力は必ず JSON 配列のみ。スキーマ: [{\"partnerCode\":\"...\",\"items\":[{\"memo\":\"...\",\"label\":\"...\"}]}]\n- JSON以外の文字は出力しない\n対象スコープ: 部門=${deptCode}, 科目=${subjectCode}\n取引先配列(JSON):\n${JSON.stringify(
          payload,
          null,
          2
        )}`;

        try {
          const r = await withResponseTracing(
            () =>
              client.responses.create({
                model: AI_GROUPING.model,
                input: prompt,
                // temperature: 0.1,
                metadata: {
                  workflowId,
                  type: "autogroup",
                  ym,
                  deptCode,
                  subjectCode,
                },
              }),
            { input: payload, attachResponse: true }
          );

          const textRaw = (r.output_text ?? "").trim();
          const text = (() => {
            const fence = textRaw.match(/```(?:json)?\n([\s\S]*?)```/i);
            if (fence) return fence[1];
            const i = textRaw.indexOf("[");
            const j = textRaw.lastIndexOf("]");
            if (i >= 0 && j > i) return textRaw.slice(i, j + 1);
            return textRaw;
          })();

          const arr: {
            partnerCode: string;
            items: { memo: string; label: string }[];
          }[] = JSON.parse(text);

          // 各取引先のローカルグループを構築
          const results: {
            partnerCode: string;
            groups: { name: string; ids: string[]; total: number }[];
          }[] = [];
          const mapByPartner = new Map<string, Map<string, string>>();
          for (const pr of arr) {
            const m = new Map<string, string>();
            for (const it of pr.items) {
              const memos = splitMemos(it.memo);
              const label = normalize(it.label);
              for (const mm of memos) m.set(normalize(mm), label);
            }
            mapByPartner.set(pr.partnerCode, m);
          }

          for (const pt of partnerTasks) {
            const mapping =
              mapByPartner.get(pt.partnerCode) ?? new Map<string, string>();
            const local = new Map<
              string,
              { name: string; ids: string[]; total: number }
            >();
            for (const e of entriesByPartner.get(pt.partnerCode) ?? []) {
              const keyMemo = normalize(e.memo);
              const label = mapping.get(keyMemo) ?? keyMemo;
              const key = `${pt.partnerCode}|${label}`;
              const g = local.get(key) ?? { name: label, ids: [], total: 0 };
              g.ids.push(e.id);
              g.total += n(e.debit) - n(e.credit);
              local.set(key, g);
            }
            // 日本語化: 取引先単位のグルーピング結果
            const pn = nameByPartner.get(pt.partnerCode) || pt.partnerCode;
            logWorkflow(
              workflowId,
              `取引先処理完了: 取引先=${pn}(${pt.partnerCode}), グループ数=${local.size}`
            );
            results.push({
              partnerCode: pt.partnerCode,
              groups: Array.from(local.values()),
            });
          }
          return results;
        } catch (e) {
          console.warn("auto-group openai error (scope)", e);
          // 日本語化: AIエラー（スコープ単位）
          logWorkflow(
            workflowId,
            `AIエラー: 部門=${deptCode}, 科目=${subjectCode}: ${String(e).slice(
              0,
              200
            )}`
          );
          // フォールバック: メモをそのままラベルに
          const results: {
            partnerCode: string;
            groups: { name: string; ids: string[]; total: number }[];
          }[] = [];
          for (const pt of partnerTasks) {
            const local = new Map<
              string,
              { name: string; ids: string[]; total: number }
            >();
            for (const e of entriesByPartner.get(pt.partnerCode) ?? []) {
              const label = normalize(e.memo);
              const key = `${pt.partnerCode}|${label}`;
              const g = local.get(key) ?? { name: label, ids: [], total: 0 };
              g.ids.push(e.id);
              g.total += n(e.debit) - n(e.credit);
              local.set(key, g);
            }
            results.push({
              partnerCode: pt.partnerCode,
              groups: Array.from(local.values()),
            });
          }
          return results;
        }
      }
    );

    // マージ
    for (const pr of partnerResults) {
      for (const g of pr.groups) {
        const key = `${pr.partnerCode}|${g.name}`;
        const existing = groups.get(key) ?? { name: g.name, ids: [], total: 0 };
        existing.ids.push(...g.ids);
        existing.total += g.total;
        groups.set(key, existing);
      }
    }
  } else {
    // APIキー未設定: メモ厳密一致で分割
    for (const e of entries) {
      const label = normalize(e.memo);
      const key = `${e.partnerCode}|${label}`;
      const g = groups.get(key) ?? { name: label, ids: [], total: 0 };
      g.ids.push(e.id);
      g.total += n(e.debit) - n(e.credit);
      groups.set(key, g);
    }
  }

  // プロジェクトを一括作成（絶対額降順）
  // 重要: 取引先が異なる同名ラベルは別プロジェクトにするため、
  // groups の key(partnerCode|label) を保持したまま並べ替え・登録する。
  const sorted = Array.from(groups.entries())
    .map(([key, g]) => ({ key, ...g }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  const projectsData = sorted.map((g, idx) => ({
    id: randomUUID(),
    datasetId: ds.id,
    name: g.name,
    orderNo: idx,
  }));
  if (projectsData.length > 0) {
    await prisma.project.createMany({
      data: projectsData,
      skipDuplicates: true,
    });
  }

  // ProjectEntryを一括作成（チャンク）
  const idByKey = new Map<string, string>();
  sorted.forEach((g, idx) => idByKey.set(g.key, projectsData[idx].id));
  const entriesData: { projectId: string; entryId: string; linkedAt: Date }[] =
    [];
  for (const g of sorted) {
    const pid = idByKey.get(g.key)!;
    for (const id of g.ids)
      entriesData.push({ projectId: pid, entryId: id, linkedAt: new Date() });
  }
  const LINK_CHUNK = 2000;
  for (let i = 0; i < entriesData.length; i += LINK_CHUNK) {
    const slice = entriesData.slice(i, i + LINK_CHUNK);
    await prisma.projectEntry.createMany({ data: slice, skipDuplicates: true });
  }

  // 日本語化: 自動グループ化の完了
  logWorkflow(
    workflowId,
    `自動グループ化完了: 部門=${deptCode}, 科目=${subjectCode}, 作成案件=${projectsData.length}, 紐付け件数=${entriesData.length}`
  );
  return {
    ok: true,
    result: {
      created: projectsData.length,
      projects: projectsData.map((p) => ({
        id: p.id,
        name: p.name,
        total: sorted.find((g) => g.name === p.name)?.total ?? 0,
      })),
    },
  };
}
