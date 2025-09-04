"use client";
import * as React from "react";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BRANCHES } from "@/constants/masterdata/master-data";
import { Loader2 } from "lucide-react";

type Props = {
  onSubmit: (form: FormData) => Promise<{ ok: boolean; error?: string; file?: { name: string; mime: string; base64: string } }>;
};

export default function LedgerForm({ onSubmit }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const downloadRef = useRef<HTMLAnchorElement | null>(null);

  const pushLog = (msg: string) => {
    setLogs((prev) => [...prev, msg]);
  };

  async function handleAction(formData: FormData) {
    setLoading(true);
    setError(null);
    setLastFile(null);
    setLogs([]);

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
      if (!res?.ok) {
        setError(res?.error ?? "エラーが発生しました");
        pushLog(`  └ エラー: ${res?.error ?? "不明なエラー"}`);
        return;
      }
      pushLog("  └ 照合処理が完了しました");
      const file = res.file as
        | { name: string; mime: string; base64: string }
        | undefined;
      if (!file) {
        setError("出力ファイルの生成に失敗しました");
        pushLog("  └ 出力ファイルの生成に失敗しました");
        return;
      }
      try {
        pushLog("[3/4] 結果ファイルを作成中...");
        const blob = new Blob(
          [Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))],
          { type: file.mime }
        );
        const url = URL.createObjectURL(blob);
        setLastFile(file.name);
        pushLog("[4/4] ダウンロードを開始します...");
        if (downloadRef.current) {
          downloadRef.current.href = url;
          downloadRef.current.download = file.name;
          downloadRef.current.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        }
        pushLog("  └ ダウンロードリンクを開きました");
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
    <div className="mx-auto max-w-4xl w-full space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>本支店勘定の照合（元帳A/B）</CardTitle>
        </CardHeader>
        <CardContent>
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
                        {b.name} ({b.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ledgerA">
                    支店Aの元帳（XLSX, 1ファイル）
                  </Label>
                  <Input
                    id="ledgerA"
                    name="ledgerA"
                    type="file"
                    accept=".xlsx"
                    required
                  />
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
                        {b.name} ({b.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ledgerB">
                    支店Bの元帳（XLSX, 1ファイル）
                  </Label>
                  <Input
                    id="ledgerB"
                    name="ledgerB"
                    type="file"
                    accept=".xlsx"
                    required
                  />
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
                }}
              >
                クリア
              </Button>
              <a ref={downloadRef} className="hidden" aria-hidden />
            </div>
            {/* 実行ボタン下のリアルタイムログ */}
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
            {lastFile && (
              <p className="text-sm text-muted-foreground">
                出力ファイルをダウンロードしました: {lastFile}
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
