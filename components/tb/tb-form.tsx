"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useState } from "react";
import { Loader2 } from "lucide-react";

type Props = {
  onSubmit: (form: FormData) => Promise<{ ok: boolean; error?: string; results?: Array<{ leftBranch: string; rightBranch: string; leftAmount: number; rightAmount: number; diff: number; leftBranchName: string; rightBranchName: string; period: string }> }>;
};

export default function TbForm({ onSubmit }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Array<{ leftBranch: string; rightBranch: string; leftAmount: number; rightAmount: number; diff: number; leftBranchName: string; rightBranchName: string; period: string }> | null>(null);

  async function handleAction(formData: FormData) {
    setLoading(true);
    setError(null);
    setRows(null);
    const res = await onSubmit(formData);
    setLoading(false);
    if (!res?.ok) {
      setError(res?.error ?? "エラーが発生しました");
    } else {
      setRows(res.results ?? []);
    }
  }

  return (
    <div className="mx-auto max-w-4xl w-full space-y-6">
      <Card>
        <CardHeader className="font-normal">
          <CardTitle>本支店勘定の照合（TB）</CardTitle>
        </CardHeader>
        <CardContent className="font-normal">
          <form action={handleAction} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="period">対象期間 (YYYY-MM)</Label>
                <Input
                  id="period"
                  name="period"
                  type="month"
                  required
                  defaultValue={new Date().toISOString().slice(0, 7)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="tb">試算表ファイル（XLSX, 1ファイル）</Label>
                <Input id="tb" name="tb" type="file" accept=".xlsx" required />
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
                  setRows(null);
                }}
              >
                クリア
              </Button>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Switch
                id="aggregatePayments"
                name="aggregatePayments"
                defaultChecked
              />
              <Label htmlFor="aggregatePayments">店を集約</Label>
            </div>
          </form>
          {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {Array.isArray(rows) && (
        <Card>
          <CardHeader className="font-normal">
            <CardTitle>照合結果（ペア別）</CardTitle>
          </CardHeader>
          <CardContent>
            <Table className="font-normal">
              <TableHeader>
                <TableRow>
                  <TableHead>支店A</TableHead>
                  <TableHead>支店B</TableHead>
                  <TableHead className="text-right">A→B 期末残高</TableHead>
                  <TableHead className="text-right">B→A 期末残高</TableHead>
                  <TableHead className="text-right">差額（A+B）</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5}>
                      一致しないペアはありませんでした。
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r, i: number) => (
                    <TableRow
                      key={i}
                      className={
                        Math.abs(r.diff) > 0
                          ? "bg-amber-50 dark:bg-amber-900/20"
                          : ""
                      }
                    >
                      <TableCell>
                        {r.leftBranchName} ({r.leftBranch})
                      </TableCell>
                      <TableCell>
                        {r.rightBranchName} ({r.rightBranch})
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.leftAmount.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.rightAmount.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-normal">
                        {r.diff.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
