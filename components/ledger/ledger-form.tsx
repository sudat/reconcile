"use client";
import * as React from "react";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BRANCHES } from "@/constants/masterdata/master-data";
import { maskBranchName } from "@/lib/mask";
import { Loader2 } from "lucide-react";

type DownloadFile = { name: string; mime: string; base64: string };
type Props = {
  onSubmit: (
    form: FormData
  ) => Promise<
    | { ok: false; error?: string }
    | { ok: true; files: DownloadFile[]; meta?: { hasUnmatch?: boolean; diffDays?: number; unmatchCountA?: number; unmatchCountB?: number }; analysis?: unknown }
  >;
};

export default function LedgerForm({ onSubmit }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiReqRef = useRef(0); // AIリクエストの無効化用トークン
  const downloadRef = useRef<HTMLAnchorElement | null>(null);

  const pushLog = (msg: string) => {
    setLogs((prev) => [...prev, msg]);
  };

  async function handleAction(formData: FormData) {
    setLoading(true);
    setError(null);
    setLastFile(null);
    setLogs([]);
    setAiLoading(false);
    setAiSummary(null);
    setAiError(null);
    aiReqRef.current++; // 前回のAI処理を無効化

    try {
      const { upload } = await import("@vercel/blob/client");

      // 1) 元のFormDataから必要フィールドを取得
      const period = String(formData.get("period") || "");
      const branchA = String(formData.get("branchA") || "");
      const branchB = String(formData.get("branchB") || "");
      const fileA = formData.get("ledgerA") as File | null;
      const fileB = formData.get("ledgerB") as File | null;
      if (!period || !branchA || !branchB || !fileA || !fileB) {
        setLoading(false);
        setError("入力が不足しています");
        return;
      }

      // 2) 先にVercel Blobへアップロード（multipartで大容量回避）
      pushLog("[1/4] ファイルをアップロードしています（A/B）...");
      const [upA, upB] = await Promise.all([
        upload(fileA.name, fileA, {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
          multipart: true,
        }),
        upload(fileB.name, fileB, {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
          multipart: true,
        }),
      ]);
      pushLog("  └ アップロード完了");

      // 3) Server Action へはURLのみ渡す（本体はBlobにある）
      const fd = new FormData();
      fd.set("period", period);
      fd.set("branchA", branchA);
      fd.set("branchB", branchB);
      fd.set("ledgerAUrl", upA.url);
      fd.set("ledgerBUrl", upB.url);

      pushLog("[2/4] サーバで照合処理を実行中...");
      const res = await onSubmit(fd);
      if (!res || res.ok === false) {
        const errorMsg = (res && 'error' in res) ? res.error : undefined;
        setError(errorMsg ?? "エラーが発生しました");
        pushLog(`  └ エラー: ${errorMsg ?? "不明なエラー"}`);
        return;
      }
      pushLog("  └ 照合処理が完了しました");
      const files = res.files ?? [];
      if (files.length === 0) {
        setError("出力ファイルの生成に失敗しました");
        pushLog("  └ 出力ファイルの生成に失敗しました");
        return;
      }
      try {
        // 1つ目（by_day）
        pushLog("[3/4] 日別の照合ファイルを作成中...");
        const [file1, file2] = files;
        const blob1 = new Blob(
          [Uint8Array.from(atob(file1.base64), (c) => c.charCodeAt(0))],
          { type: file1.mime }
        );
        const url1 = URL.createObjectURL(blob1);
        setLastFile(file1.name);
        pushLog("[4/4] ダウンロードを開始します...");
        if (downloadRef.current) {
          downloadRef.current.href = url1;
          downloadRef.current.download = file1.name;
          downloadRef.current.click();
          setTimeout(() => URL.revokeObjectURL(url1), 5000);
        }
        pushLog("  └ 日別の照合ファイルをダウンロードしました");

        // アンマッチがあれば2つ目（unmatched）も続けてダウンロード
        if (file2) {
          pushLog("[追加] アンマッチ抽出の結果ファイルを作成中...");
          const blob2 = new Blob(
            [Uint8Array.from(atob(file2.base64), (c) => c.charCodeAt(0))],
            { type: file2.mime }
          );
          const url2 = URL.createObjectURL(blob2);
          if (downloadRef.current) {
            downloadRef.current.href = url2;
            downloadRef.current.download = file2.name;
            downloadRef.current.click();
            setTimeout(() => URL.revokeObjectURL(url2), 5000);
          }
          pushLog(
            `  └ アンマッチファイルをダウンロードしました (${res.meta?.unmatchCountA ?? 0}件(A) / ${res.meta?.unmatchCountB ?? 0}件(B))`
          );

          // アンマッチがある場合はAI分析をバックグラウンド開始
          if (res.meta?.hasUnmatch && res.analysis) {
            const reqId = ++aiReqRef.current;
            try {
              setAiLoading(true);
              pushLog("[AI] アンマッチ結果を分析中…");
              const r = await fetch("/api/ai/ledger-unmatch", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(res.analysis),
              });
              const json = await r.json();
              if (aiReqRef.current !== reqId) return; // クリア/再実行で無効化された場合は破棄
              if (!json.ok) {
                setAiError(json.error || "AI分析に失敗しました");
                pushLog("[AI] 解析エラー: " + (json.error || "不明なエラー"));
              } else {
                setAiSummary(json.summary as string);
                pushLog("[AI] 分析が完了しました");
              }
            } catch (e) {
              console.error(e);
              if (aiReqRef.current !== reqId) return; // 無効化済みなら何もしない
              setAiError("AI分析に失敗しました");
              pushLog("[AI] 解析中にエラーが発生しました");
            } finally {
              if (aiReqRef.current === reqId) setAiLoading(false);
            }
          }
        }
      } catch (e) {
        console.error(e);
        setError("ダウンロードに失敗しました");
        pushLog("  └ ダウンロードに失敗しました");
      }
    } catch (e) {
      console.error(e);
      setError("アップロードに失敗しました");
      pushLog("  └ アップロードに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full space-y-6">
      <div className="space-y-4">
        <h2 className="text-base font-medium">本支店勘定の照合（元帳A/B）</h2>
        <form action={handleAction} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="period-ledger">対象期間 (YYYY-MM)</Label>
              <Input
                id="period-ledger"
                name="period"
                type="month"
                required
                defaultValue={new Date().toISOString().slice(0, 7)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="branchA">支店A</Label>
                <select
                  id="branchA"
                  name="branchA"
                  required
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                >
                  <option value="" disabled>
                    選択してください
                  </option>
                  {BRANCHES.map((b) => (
                    <option key={b.code} value={b.code}>
                      {maskBranchName(b.name)} ({b.code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ledgerA">支店Aの元帳（XLSX, 1ファイル）</Label>
                <Input id="ledgerA" name="ledgerA" type="file" accept=".xlsx" required />
              </div>
            </div>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="branchB">支店B</Label>
                <select
                  id="branchB"
                  name="branchB"
                  required
                  className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                >
                  <option value="" disabled>
                    選択してください
                  </option>
                  {BRANCHES.map((b) => (
                    <option key={b.code} value={b.code}>
                      {maskBranchName(b.name)} ({b.code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ledgerB">支店Bの元帳（XLSX, 1ファイル）</Label>
                <Input id="ledgerB" name="ledgerB" type="file" accept=".xlsx" required />
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <Button type="submit" disabled={loading} aria-busy={loading}>
              {loading ? (
                <>
                  <Loader2 className="animate-spin" />
                  照合中...
                </>
              ) : (
                "照合を実行"
              )}
            </Button>
            <Button
              type="reset"
              variant="outline"
              onClick={() => {
                setError(null);
                setLastFile(null);
                setLogs([]);
                aiReqRef.current++; // 進行中のAIを無効化
                setAiLoading(false);
                setAiSummary(null);
                setAiError(null);
              }}
            >
              クリア
            </Button>
            <a ref={downloadRef} className="hidden" aria-hidden />
          </div>

          {logs.length > 0 && (
            <div
              className="mt-3 rounded-md border bg-muted/40 p-3 text-xs font-mono text-muted-foreground max-h-40 overflow-auto"
              role="log"
              aria-live="polite"
            >
              {logs.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          )}
          {(aiLoading || aiSummary || aiError) && (
            <div className="mt-3 rounded-md border bg-muted/40 p-3 text-sm space-y-2">
              <div className="text-xs font-medium text-muted-foreground">AI分析</div>
              {aiLoading && (
                <div className="inline-flex items-center gap-2 text-sm">
                  <Loader2 className="animate-spin" /> AI分析中…
                </div>
              )}
              {aiError && <div className="text-destructive text-sm">{aiError}</div>}
              {aiSummary && (
                <pre className="whitespace-pre-wrap text-xs leading-5">{aiSummary}</pre>
              )}
            </div>
          )}
          {lastFile && (
            <p className="text-sm text-muted-foreground">出力ファイルをダウンロードしました: {lastFile}</p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      </div>
    </div>
  );
}
