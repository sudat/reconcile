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
// 部門ベース処理用の構造化出力スキーマ
const AUTO_GROUPING_SCHEMA = {
  type: "object",
  properties: {
    departmentResults: {
      type: "array",
      items: {
        type: "object",
        properties: {
          deptCode: { type: "string" },
          subjects: {
            type: "array",
            items: {
              type: "object",
              properties: {
                subjectCode: { type: "string" },
                partners: {
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
                            label: { type: "string" },
                          },
                          required: ["memo", "label"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["partnerCode", "items"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["subjectCode", "partners"],
              additionalProperties: false,
            },
          },
        },
        required: ["deptCode", "subjects"],
        additionalProperties: false,
      },
    },
  },
  required: ["departmentResults"],
  additionalProperties: false,
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

// 部門処理単位の集計結果型
type DepartmentResult = {
  datasetId: string;
  created: number;
  projects: AutoGroupResult["projects"];
};

/**
 * 取引先×摘要で案件を自動生成（初回のみ）。
 * - 既にプロジェクトが存在する場合は何もしない（force指定時を除く）。
 * - Heuristicで分類し、残りはOpenAI(gpt-4o-mini)に要約ラベルを依頼。
 */
export async function ensureAutoGrouping(
  form: FormData
): Promise<{ ok: boolean; error?: string; result?: AutoGroupResult }> {
  // ログ抑制フラグ（不要ログ①②③をデフォルト非表示）
  // AUTOGROUP_VERBOSE_LOG=true の時のみ詳細ログを出力
  const VERBOSE_AUTOGROUP_LOG = process.env.AUTOGROUP_VERBOSE_LOG === "true";
  await waitNeonReady("auto-group");
  const ym = String(form.get("ym") || "");
  const deptCode = String(form.get("deptCode") || "");
  const subjectCode = String(form.get("subjectCode") || "");
  const subjectCodesJson = String(form.get("subjectCodes") || "");
  const workflowId = String(form.get("workflowId") || "");

  // 部門統合処理（複数科目）または従来処理（単一科目）
  const isMultiSubject = Boolean(subjectCodesJson);
  const subjectCodes = isMultiSubject
    ? JSON.parse(subjectCodesJson)
    : [subjectCode];

  if (!ym || !deptCode || (!subjectCode && !isMultiSubject))
    return { ok: false, error: "パラメータが不足しています" };

  // 部門内の全データセット（科目別）を取得
  const datasets = await prisma.dataset.findMany({
    where: {
      deptCode,
      ym,
      subjectCode: { in: subjectCodes },
    },
  });

  if (datasets.length === 0) {
    return { ok: false, error: "該当するデータセットが見つかりません" };
  }

  // 部門内の全仕訳を一括取得
  const allEntries = await prisma.entry.findMany({
    where: { 
      datasetId: { in: datasets.map(ds => ds.id) },
      softDeletedAt: null 
    },
    orderBy: [{ date: "asc" }, { voucherNo: "asc" }],
    select: {
      id: true,
      datasetId: true,
      memo: true,
      partnerName: true,
      partnerCode: true,
      debit: true,
      credit: true,
    },
  });

  if (allEntries.length === 0) {
    return { ok: false, error: "処理対象の仕訳が見つかりません" };
  }

  // 科目別にデータセットとエントリを整理
  const datasetById = new Map(datasets.map(ds => [ds.id, ds]));
  const entriesBySubject = new Map<string, typeof allEntries>();
  
  for (const entry of allEntries) {
    const dataset = datasetById.get(entry.datasetId);
    if (!dataset) continue;
    
    const subjectEntries = entriesBySubject.get(dataset.subjectCode) || [];
    subjectEntries.push(entry);
    entriesBySubject.set(dataset.subjectCode, subjectEntries);
  }

  // 科目別×取引先別にデータを整理（部門単位処理用）
  type SubjectPartnerData = {
    subjectCode: string;
    partners: {
      partnerCode: string;
      partnerName: string;
      memos: string[];
    }[];
  };

  const subjectPartnerData: SubjectPartnerData[] = [];
  const allEntriesByKey = new Map<string, typeof allEntries[0][]>(); // subjectCode|partnerCode => entries

  // 科目ごとに取引先データを構築
  for (const [subjectCode, entries] of entriesBySubject.entries()) {
    const memosByPartner = new Map<string, Set<string>>();
    const nameByPartner = new Map<string, string>();

    for (const entry of entries) {
      const set = memosByPartner.get(entry.partnerCode) ?? new Set<string>();
      set.add(normalize(entry.memo));
      memosByPartner.set(entry.partnerCode, set);
      
      if (entry.partnerName) {
        nameByPartner.set(entry.partnerCode, entry.partnerName);
      }

      // エントリをキー別に保存
      const key = `${subjectCode}|${entry.partnerCode}`;
      const keyEntries = allEntriesByKey.get(key) || [];
      keyEntries.push(entry);
      allEntriesByKey.set(key, keyEntries);
    }

    // 科目の取引先データを構築
    const partners = Array.from(memosByPartner.entries()).map(([partnerCode, memoSet]) => ({
      partnerCode,
      partnerName: nameByPartner.get(partnerCode) || partnerCode,
      memos: Array.from(memoSet),
    }));

    subjectPartnerData.push({
      subjectCode,
      partners,
    });
  }

  const apiKey =
    process.env.OPENAI_API_KEY ||
    (process.env as Record<string, string | undefined>).OPEN_API_KEY;

  if (apiKey) {
    const client = new OpenAI({ apiKey });

    // 部門単位での1回のOpenAI API呼び出し
    const departmentResults = await withSpan(
      {
        name: "department_autogroup",
        metadata: { ym, deptCode, subjectCodes: subjectCodes.join(",") },
      },
      async () => {
        logWorkflow(
          workflowId,
          `部門単位自動グループ化開始: 部門=${deptCode}, 科目=${subjectCodes.join(",")}`
        );
        const abstr = Math.max(0, Math.min(1, AI_GROUPING.abstraction));
        const guide =
          abstr >= 0.8
            ? `可能な限り一般名詞へ統一（例: "電気代"/"水道代"/"ガス代"/"クレジット手数料"/"振替"/"返金" など）。\n\n(point.1)半年間で1年間使い続けられる簡潔な名称が良い。逆に月/期間/回数/支番等の枝葉末節の情報は不要。\n\n不要情報の事例：8月度⇒月度情報は具体過ぎる、8/1~8/15⇒期間情報は具体過ぎる、3回目⇒回数情報は具体過ぎる。\n\n(point.2)簡潔で分かりやすい表現が良い。逆に冗長な表現は不要。冗長な表現とは"関連","合計"だとか曖昧な言葉を指します。例えば電気料金関連費用という必要はない。電気料金だけで良い。\n\n事例毎に冗長表現・簡潔表現の例をならべる：クレジットカード関連の手数料 ⇒ クレジットカード手数料、各種決済手数料関連費用 ⇒ 各種決済手数料、\t電気料金の支払い費用。⇒ 電気料金。`
            : abstr >= 0.5
            ? `月/期間/回数/支番などの補助情報は省略し、要点語を残す（例: "電気代", "水道代", "クレジット手数料(セゾン)"）。`
            : `摘要の表現をできるだけ保持しつつ、末尾のノイズ（全角括弧の注記など）は省略。`;

        const systemPrompt = `あなたは会計データのアシスタントです。次の部門の科目別×取引先別の摘要リストを、科目ごと・取引先ごとに案件名（短いラベル）でグループ化してください。

グループ化方針（抽象化強度=${abstr.toFixed(2)}）: ${guide}

ルール:
- ラベルは10～18文字程度の日本語
- 括弧は最小限に使用
- 対象スコープ: 部門=${deptCode}
- 科目別に結果を返してください`;

        const userPrompt = `部門データ:\n${JSON.stringify(subjectPartnerData, null, 2)}`;

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
                      name: "department_autogroup_result",
                      schema: {
                        type: "object",
                        properties: {
                          subjectResults: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                subjectCode: { type: "string" },
                                partnerResults: {
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
                                            label: { type: "string" },
                                          },
                                          required: ["memo", "label"],
                                          additionalProperties: false,
                                        },
                                      },
                                    },
                                    required: ["partnerCode", "items"],
                                    additionalProperties: false,
                                  },
                                },
                              },
                              required: ["subjectCode", "partnerResults"],
                              additionalProperties: false,
                            },
                          },
                        },
                        required: ["subjectResults"],
                        additionalProperties: false,
                      },
                      strict: true,
                    },
                  },
                }),
              { input: subjectPartnerData, attachResponse: true }
            );

            // refusal チェック
            if (response.choices[0]?.message.refusal) {
              throw new Error(
                `API request was refused: ${response.choices[0].message.refusal}`
              );
            }

          // 構造化出力からJSONを取得
          const content = response.choices[0]?.message.content;
          if (!content) {
            throw new Error("構造化された応答の取得に失敗しました");
          }

          let parsed: { 
            subjectResults: {
              subjectCode: string;
              partnerResults: {
                partnerCode: string;
                items: { memo: string; label: string; }[];
              }[];
            }[];
          };
          try {
            parsed = JSON.parse(content);
          } catch (parseError) {
            throw new Error(`JSON解析エラー: ${parseError}`);
          }

          if (!parsed?.subjectResults || !Array.isArray(parsed.subjectResults)) {
            throw new Error("期待された構造の応答が得られませんでした");
          }

          // 部門レベルでの結果を科目別に処理
          const departmentResults: DepartmentResult[] = [];
          
          for (const subjectResult of parsed.subjectResults) {
            if (!subjectResult.subjectCode || typeof subjectResult.subjectCode !== "string") {
              logWorkflow(workflowId, `警告: 無効なsubjectCode: ${JSON.stringify(subjectResult)}`);
              continue;
            }

            const subjectCode = subjectResult.subjectCode;
            const dataset = datasets.find(ds => ds.subjectCode === subjectCode);
            if (!dataset) {
              logWorkflow(workflowId, `警告: データセットが見つかりません: ${subjectCode}`);
              continue;
            }

            const subjectEntries = entriesBySubject.get(subjectCode) || [];
            if (subjectEntries.length === 0) continue;

            // 科目単位でプロジェクト・グループを作成
            const groups = new Map<string, { name: string; ids: string[]; total: number }>();
            const nameByPartner = new Map<string, string>();
            
            // 取引先名を収集
            for (const entry of subjectEntries) {
              if (entry.partnerName) {
                nameByPartner.set(entry.partnerCode, entry.partnerName);
              }
            }

            // AI結果からマッピングを構築
            const mappingByPartner = new Map<string, Map<string, string>>();
            
            for (const partnerResult of subjectResult.partnerResults || []) {
              if (!partnerResult.partnerCode || !Array.isArray(partnerResult.items)) {
                continue;
              }
              
              const mapping = new Map<string, string>();
              for (const item of partnerResult.items) {
                if (item.memo && item.label && 
                    typeof item.memo === "string" && 
                    typeof item.label === "string" &&
                    item.label.trim().length > 0) {
                  const memoList = splitMemos(item.memo);
                  const label = normalize(item.label.trim());

                  for (const memo of memoList) {
                    const normalizedMemo = normalize(memo);
                    if (normalizedMemo.length > 0) {
                      mapping.set(normalizedMemo, label);
                      // プレフィックスマッチング用
                      if (normalizedMemo.length >= 3) {
                        const prefix = normalizedMemo.substring(0, Math.min(normalizedMemo.length - 1, 10));
                        if (prefix.length >= 3) {
                          mapping.set(prefix, label);
                        }
                      }
                    }
                  }
                }
              }
              
              if (mapping.size > 0) {
                mappingByPartner.set(partnerResult.partnerCode, mapping);
                if (VERBOSE_AUTOGROUP_LOG) {
                  logWorkflow(
                    workflowId,
                    `取引先${partnerResult.partnerCode}のマッピング数: ${mapping.size}`
                  );
                }
              }
            }

            // エントリをグループ化
            let matchedCount = 0;
            let unmatchedCount = 0;

            for (const entry of subjectEntries) {
              const keyMemo = normalize(entry.memo);
              let label = null;
              
              // 該当取引先のマッピングを確認
              const partnerMapping = mappingByPartner.get(entry.partnerCode);
              if (partnerMapping) {
                label = partnerMapping.get(keyMemo);
                
                if (!label) {
                  // 部分一致検索
                  for (const [mappedMemo, mappedLabel] of partnerMapping) {
                    if (keyMemo.includes(mappedMemo) || mappedMemo.includes(keyMemo)) {
                      label = mappedLabel;
                      if (VERBOSE_AUTOGROUP_LOG) {
                        logWorkflow(
                          workflowId,
                          `部分一致: ${keyMemo} → ${mappedMemo} (${mappedLabel})`
                        );
                      }
                      break;
                    }
                  }
                }
              }

              if (!label) {
                label = keyMemo;
                unmatchedCount++;
              } else {
                matchedCount++;
              }

              const key = `${entry.partnerCode}|${label}`;
              const group = groups.get(key) ?? { name: label, ids: [], total: 0 };
              group.ids.push(entry.id);
              group.total += n(entry.debit) - n(entry.credit);
              groups.set(key, group);
            }

            if (VERBOSE_AUTOGROUP_LOG) {
              logWorkflow(
                workflowId,
                `科目${subjectCode}: マッチ${matchedCount}件, 未マッチ${unmatchedCount}件`
              );
            }

            // プロジェクト作成
            const sorted = Array.from(groups.entries())
              .map(([key, g]) => ({ key, ...g }))
              .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
              
            const projectsData = sorted.map((g, idx) => {
              const partnerCode = g.key.split("|")[0];
              const partnerName = nameByPartner.get(partnerCode) || partnerCode;

              return {
                id: randomUUID(),
                datasetId: dataset.id,
                name: g.name,
                partnerName: partnerName,
                orderNo: idx,
              };
            });

            if (projectsData.length > 0) {
              await prisma.project.createMany({
                data: projectsData,
                skipDuplicates: true,
              });
            }

            // ProjectEntry作成
            const idByKey = new Map<string, string>();
            sorted.forEach((g, idx) => idByKey.set(g.key, projectsData[idx].id));
            const entriesData: {
              projectId: string;
              entryId: string;
              linkedAt: Date;
            }[] = [];
            
            for (const g of sorted) {
              const pid = idByKey.get(g.key)!;
              for (const id of g.ids) {
                entriesData.push({ projectId: pid, entryId: id, linkedAt: new Date() });
              }
            }
            
            const LINK_CHUNK = 2000;
            for (let i = 0; i < entriesData.length; i += LINK_CHUNK) {
              const slice = entriesData.slice(i, i + LINK_CHUNK);
              await prisma.projectEntry.createMany({
                data: slice,
                skipDuplicates: true,
              });
            }

            if (VERBOSE_AUTOGROUP_LOG) {
              logWorkflow(
                workflowId,
                `科目${subjectCode}処理完了: プロジェクト${projectsData.length}件, エントリ${entriesData.length}件`
              );
            }

            departmentResults.push({
              datasetId: dataset.id,
              created: projectsData.length,
              projects: projectsData.map((p) => ({
                id: p.id,
                name: p.name,
                total: sorted.find((g) => g.name === p.name)?.total ?? 0,
              })),
            });
          }

          if (VERBOSE_AUTOGROUP_LOG) {
            logWorkflow(
              workflowId,
              `部門${deptCode}の全科目処理完了: 検証済み科目数=${departmentResults.length}`
            );
          }
          return departmentResults;
        } catch (e) {
          console.warn("部門単位auto-group openai error", e);
          logWorkflow(
            workflowId,
            `部門AIエラー: 部門=${deptCode}: ${String(e).slice(0, 200)}`
          );
          
          // フォールバック処理（科目別に基本的なグループ化）
          const fallbackResults: DepartmentResult[] = [];
          
          for (const [subjectCode, entries] of entriesBySubject.entries()) {
            const dataset = datasets.find(ds => ds.subjectCode === subjectCode);
            if (!dataset || entries.length === 0) continue;

            const groups = new Map<string, { name: string; ids: string[]; total: number }>();
            const nameByPartner = new Map<string, string>();

            for (const entry of entries) {
              if (entry.partnerName) {
                nameByPartner.set(entry.partnerCode, entry.partnerName);
              }
              
              const label = normalize(entry.memo);
              const key = `${entry.partnerCode}|${label}`;
              const group = groups.get(key) ?? { name: label, ids: [], total: 0 };
              group.ids.push(entry.id);
              group.total += n(entry.debit) - n(entry.credit);
              groups.set(key, group);
            }

            // プロジェクト作成（フォールバック）
            const sorted = Array.from(groups.entries())
              .map(([key, g]) => ({ key, ...g }))
              .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
              
            const projectsData = sorted.map((g, idx) => {
              const partnerCode = g.key.split("|")[0];
              const partnerName = nameByPartner.get(partnerCode) || partnerCode;

              return {
                id: randomUUID(),
                datasetId: dataset.id,
                name: g.name,
                partnerName: partnerName,
                orderNo: idx,
              };
            });

            if (projectsData.length > 0) {
              await prisma.project.createMany({
                data: projectsData,
                skipDuplicates: true,
              });

              // ProjectEntry作成
              const idByKey = new Map<string, string>();
              sorted.forEach((g, idx) => idByKey.set(g.key, projectsData[idx].id));
              const entriesData: {
                projectId: string;
                entryId: string;
                linkedAt: Date;
              }[] = [];
              
              for (const g of sorted) {
                const pid = idByKey.get(g.key)!;
                for (const id of g.ids) {
                  entriesData.push({ projectId: pid, entryId: id, linkedAt: new Date() });
                }
              }
              
              const LINK_CHUNK = 2000;
              for (let i = 0; i < entriesData.length; i += LINK_CHUNK) {
                const slice = entriesData.slice(i, i + LINK_CHUNK);
                await prisma.projectEntry.createMany({
                  data: slice,
                  skipDuplicates: true,
                });
              }
            }

            fallbackResults.push({
              datasetId: dataset.id,
              created: projectsData.length,
              projects: projectsData.map((p) => ({
                id: p.id,
                name: p.name,
                total: sorted.find((g) => g.name === p.name)?.total ?? 0,
              })),
            });
          }
          
          logWorkflow(workflowId, `フォールバック処理完了: 科目数=${fallbackResults.length}`);
          return fallbackResults;
        }
      }
    );

  // OpenAI API処理が完了した場合の結果
  const totalCreated = departmentResults.reduce((sum: number, r: DepartmentResult) => sum + r.created, 0);
  const allProjects = departmentResults.flatMap((r: DepartmentResult) => r.projects);

  return {
    ok: true,
    result: {
      created: totalCreated,
      projects: allProjects,
    },
  };
  } else {
    // APIキー未設定の場合のフォールバック処理
    logWorkflow(workflowId, `APIキー未設定のため基本的なグループ化を実行: 部門=${deptCode}`);
    
    const fallbackResults: DepartmentResult[] = [];
    
    for (const [subjectCode, entries] of entriesBySubject.entries()) {
      const dataset = datasets.find(ds => ds.subjectCode === subjectCode);
      if (!dataset || entries.length === 0) continue;

      const groups = new Map<string, { name: string; ids: string[]; total: number }>();
      const nameByPartner = new Map<string, string>();

      for (const entry of entries) {
        if (entry.partnerName) {
          nameByPartner.set(entry.partnerCode, entry.partnerName);
        }
        
        const label = normalize(entry.memo);
        const key = `${entry.partnerCode}|${label}`;
        const group = groups.get(key) ?? { name: label, ids: [], total: 0 };
        group.ids.push(entry.id);
        group.total += n(entry.debit) - n(entry.credit);
        groups.set(key, group);
      }

      // プロジェクト作成
      const sorted = Array.from(groups.entries())
        .map(([key, g]) => ({ key, ...g }))
        .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
        
      const projectsData = sorted.map((g, idx) => {
        const partnerCode = g.key.split("|")[0];
        const partnerName = nameByPartner.get(partnerCode) || partnerCode;

        return {
          id: randomUUID(),
          datasetId: dataset.id,
          name: g.name,
          partnerName: partnerName,
          orderNo: idx,
        };
      });

      if (projectsData.length > 0) {
        await prisma.project.createMany({
          data: projectsData,
          skipDuplicates: true,
        });

        // ProjectEntry作成
        const idByKey = new Map<string, string>();
        sorted.forEach((g, idx) => idByKey.set(g.key, projectsData[idx].id));
        const entriesData: {
          projectId: string;
          entryId: string;
          linkedAt: Date;
        }[] = [];
        
        for (const g of sorted) {
          const pid = idByKey.get(g.key)!;
          for (const id of g.ids) {
            entriesData.push({ projectId: pid, entryId: id, linkedAt: new Date() });
          }
        }
        
        const LINK_CHUNK = 2000;
        for (let i = 0; i < entriesData.length; i += LINK_CHUNK) {
          const slice = entriesData.slice(i, i + LINK_CHUNK);
          await prisma.projectEntry.createMany({
            data: slice,
            skipDuplicates: true,
          });
        }
      }

      fallbackResults.push({
        datasetId: dataset.id,
        created: projectsData.length,
        projects: projectsData.map((p) => ({
          id: p.id,
          name: p.name,
          total: sorted.find((g) => g.name === p.name)?.total ?? 0,
        })),
      });
    }
    
    return {
      ok: true,
      result: {
        created: fallbackResults.reduce((sum, r) => sum + r.created, 0),
        projects: fallbackResults.flatMap(r => r.projects),
      },
    };
  }
}
