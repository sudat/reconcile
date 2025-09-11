"use server";
import { prisma } from "@/lib/prisma";
import { waitNeonReady } from "@/lib/neon";
import OpenAI from "openai";
import { AI_GROUPING } from "@/constants/ai";
import { randomUUID } from "crypto";
import {
  // withWorkflowTrace,
  withSpan,
  withResponseTracing,
} from "@/lib/tracing";
import { logWorkflow } from "@/lib/logger";

// 構造化出力用の型定義
type AutoGroupingResult = {
  partnerCode: string;
  items: Array<{
    memo: string;
    label: string;
  }>;
};

// JSONスキーマ定義
const AUTO_GROUPING_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          partnerCode: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                memo: { type: "string" },
                label: { type: "string" }
              },
              required: ["memo", "label"],
              additionalProperties: false
            }
          }
        },
        required: ["partnerCode", "items"],
        additionalProperties: false
      }
    }
  },
  required: ["results"],
  additionalProperties: false
} as const;

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
  if (!ym || !deptCode || !subjectCode)
    return { ok: false, error: "パラメータが不足しています" };

  const ds = await prisma.dataset.findUnique({
    where: { deptCode_subjectCode_ym: { deptCode, subjectCode, ym } },
  });
  if (!ds) return { ok: false, error: "該当データセットが存在しません" };

  // 洗い替え方式：既存Projectの有無に関わらず常にAI分類を実行

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
    // プロンプトの内容は以下を参照：
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
            ? `可能な限り一般名詞へ統一（例: "電気代"/"水道代"/"ガス代"/"クレジット手数料"/"振替"/"返金" など）。\n\n(point.1)半年間や1年間使い続けられる簡潔な名称が良い。逆に月/期間/回数/枝番等の枝葉末節の情報は不要。\n\n不要情報の事例：8月度⇒月度情報は具体過ぎる、8/1~8/15⇒期間情報は具体過ぎる、3回目⇒回数情報は具体過ぎる。\n\n(point.2)簡潔で分かりやすい表現が良い。逆に冗長な表現は不要。冗長な表現とは"関連","合計"だとか曖昧な言葉を指します。例えば電気料金関連費用という必要はない。電気料金だけで良い。\n\n事例毎に冗長表現・簡潔表現の例をならべる：クレジットカード関連の手数料 ⇒ クレジットカード手数料、各種決済手数料関連費用 ⇒ 各種決済手数料、	電気料金の支払い費用。⇒ 電気料金。`
            : abstr >= 0.5
            ? `月/期間/回数/枝番などの補助情報は省略し、要点語を残す（例: "電気代", "水道代", "クレジット手数料(セゾン)"）。`
            : `摘要の表現をできるだけ保持しつつ、末尾のノイズ（全角括弧の注記など）は省略。`;
        // const MAX = Math.max(10, Math.min(500, AI_GROUPING.maxMemosPerPartner));

        const payload = partnerTasks.map((p) => ({
          partnerCode: p.partnerCode,
          partnerName: p.partnerName,
          memos: p.memos, // トークン余裕前提で全件投入
        }));

        const systemPrompt = `あなたは会計データのアシスタントです。次の部門×勘定科目の取引先ごとの摘要リストを、案件名（短いラベル）に統合してください。

グループ化方針（抽象化強度=${abstr.toFixed(2)}）: ${guide}

ルール:
- ラベルは10〜18文字程度の日本語
- 括弧は最小限に使用
- 対象スコープ: 部門=${deptCode}, 科目=${subjectCode}`;

        const userPrompt = `取引先配列:\n${JSON.stringify(payload, null, 2)}`;

        try {
          // 構造化出力対応のAPI呼び出し
          const response = await withResponseTracing(
            () =>
              client.chat.completions.create({
                model: AI_GROUPING.model || "gpt-4o-mini",
                messages: [
                  {
                    role: "system",
                    content: systemPrompt,
                  },
                  {
                    role: "user", 
                    content: userPrompt,
                  },
                ],
                temperature: 0.1,
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: "autogroup_result",
                    schema: AUTO_GROUPING_SCHEMA,
                    strict: true,
                  },
                },
              }),
            { input: payload, attachResponse: true }
          );

          // refusal チェック
          if (response.choices[0]?.message.refusal) {
            throw new Error(`API request was refused: ${response.choices[0].message.refusal}`);
          }

          // 構造化出力からJSONを取得
          const content = response.choices[0]?.message.content;
          if (!content) {
            throw new Error("構造化された応答の取得に失敗しました");
          }

          let parsed: { results: AutoGroupingResult[] };
          try {
            parsed = JSON.parse(content);
          } catch (parseError) {
            throw new Error(`JSON解析エラー: ${parseError}`);
          }

          if (!parsed?.results || !Array.isArray(parsed.results)) {
            throw new Error("期待された構造の応答が得られませんでした");
          }

          // データ検証を強化
          const arr: AutoGroupingResult[] = [];
          for (const result of parsed.results) {
            // 基本的な構造チェック
            if (!result.partnerCode || typeof result.partnerCode !== 'string') {
              logWorkflow(workflowId, `警告: 無効なpartnerCode: ${JSON.stringify(result)}`);
              continue;
            }
            
            if (!result.items || !Array.isArray(result.items)) {
              logWorkflow(workflowId, `警告: 無効なitems構造: ${result.partnerCode}`);
              continue;
            }
            
            // items の検証とクリーニング
            const validItems = [];
            for (const item of result.items) {
              if (item.memo && item.label && 
                  typeof item.memo === 'string' && 
                  typeof item.label === 'string' &&
                  item.memo.trim().length > 0 &&
                  item.label.trim().length > 0) {
                validItems.push({
                  memo: item.memo.trim(),
                  label: item.label.trim()
                });
              } else {
                logWorkflow(workflowId, `警告: 無効なitem: ${JSON.stringify(item)}`);
              }
            }
            
            if (validItems.length > 0) {
              arr.push({
                partnerCode: result.partnerCode,
                items: validItems
              });
            }
          }
          
          if (arr.length === 0) {
            throw new Error("有効なグルーピング結果が得られませんでした");
          }
          
          logWorkflow(workflowId, `検証済みの取引先数: ${arr.length}/${parsed.results.length}`);

          // 各取引先のローカルグループを構築（改良版）
          const results: {
            partnerCode: string;
            groups: { name: string; ids: string[]; total: number }[];
          }[] = [];
          
          // より確実なマッピング処理
          const mapByPartner = new Map<string, Map<string, string>>();
          for (const pr of arr) {
            const m = new Map<string, string>();
            for (const it of pr.items) {
              // memo が複数含まれている場合の処理を改善
              const memoList = splitMemos(it.memo);
              const label = normalize(it.label);
              
              for (const memo of memoList) {
                const normalizedMemo = normalize(memo);
                if (normalizedMemo.length > 0) {
                  m.set(normalizedMemo, label);
                  // 部分一致も考慮（より柔軟なマッチング）
                  if (normalizedMemo.length >= 3) {
                    // 3文字以上の場合は前方一致も登録
                    const prefix = normalizedMemo.substring(0, Math.min(normalizedMemo.length - 1, 10));
                    if (prefix.length >= 3) {
                      m.set(prefix, label);
                    }
                  }
                }
              }
            }
            mapByPartner.set(pr.partnerCode, m);
            
            // ログ出力（デバッグ用）
            logWorkflow(
              workflowId,
              `取引先${pr.partnerCode}のマッピング数: ${m.size}`
            );
          }

          for (const pt of partnerTasks) {
            const mapping =
              mapByPartner.get(pt.partnerCode) ?? new Map<string, string>();
            const local = new Map<
              string,
              { name: string; ids: string[]; total: number }
            >();
            
            let matchedCount = 0;
            let unmatchedCount = 0;
            
            for (const e of entriesByPartner.get(pt.partnerCode) ?? []) {
              const keyMemo = normalize(e.memo);
              let label = mapping.get(keyMemo);
              
              // 完全一致しない場合、部分一致を試す
              if (!label) {
                for (const [mappedMemo, mappedLabel] of mapping) {
                  // 前方一致またはキーワード一致を試す
                  if (keyMemo.includes(mappedMemo) || mappedMemo.includes(keyMemo)) {
                    label = mappedLabel;
                    logWorkflow(
                      workflowId,
                      `部分一致: ${keyMemo} → ${mappedMemo} (${mappedLabel})`
                    );
                    break;
                  }
                }
              }
              
              // まだマッチしない場合は元のmemoを使用
              if (!label) {
                label = keyMemo;
                unmatchedCount++;
              } else {
                matchedCount++;
              }
              
              const key = `${pt.partnerCode}|${label}`;
              const g = local.get(key) ?? { name: label, ids: [], total: 0 };
              g.ids.push(e.id);
              g.total += n(e.debit) - n(e.credit);
              local.set(key, g);
            }
            
            // マッチング結果のログ
            logWorkflow(
              workflowId,
              `取引先${pt.partnerCode}: マッチ${matchedCount}件, 未マッチ${unmatchedCount}件`
            );
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
