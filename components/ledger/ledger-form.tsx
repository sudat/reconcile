"use client";
import * as React from "react";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BRANCHES } from "@/constants/masterdata/master-data";

type Props = {
  onSubmit: (form: FormData) => Promise<{ ok: boolean; error?: string; file?: { name: string; mime: string; base64: string } }>;
};

export default function LedgerForm({ onSubmit }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<string | null>(null);
  const downloadRef = useRef<HTMLAnchorElement | null>(null);

  async function handleAction(formData: FormData) {
    setLoading(true);
    setError(null);
    setLastFile(null);
    const res = await onSubmit(formData);
    setLoading(false);
    if (!res?.ok) {
      setError(res?.error ?? "エラーが発生しました");
      return;
    }
    const file = res.file as
      | { name: string; mime: string; base64: string }
      | undefined;
    if (!file) {
      setError("出力ファイルの生成に失敗しました");
      return;
    }
    try {
      const blob = new Blob(
        [Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))],
        { type: file.mime }
      );
      const url = URL.createObjectURL(blob);
      setLastFile(file.name);
      if (downloadRef.current) {
        downloadRef.current.href = url;
        downloadRef.current.download = file.name;
        downloadRef.current.click();
        // revoke は少し遅延させる
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch (e) {
      console.error(e);
      setError("ダウンロードに失敗しました");
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
              <Button type="submit" disabled={loading}>
                {loading ? "照合中..." : "照合を実行"}
              </Button>
              <Button
                type="reset"
                variant="outline"
                onClick={() => {
                  setError(null);
                  setLastFile(null);
                }}
              >
                クリア
              </Button>
              <a ref={downloadRef} className="hidden" aria-hidden />
            </div>
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
