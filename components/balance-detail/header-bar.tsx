"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Download } from "lucide-react";
import { balanceExportAction } from "@/app/actions/balance-export";
import { toast } from "sonner";

type Props = {
  yearMonth: string; // "YYYY-MM"
  onYearMonthChange: (ym: string) => void;
  onShow: () => void;
  onUploadFile: (file: File, ym: string) => void;
  uploading?: boolean;
  loading?: boolean;
  statusText?: string | null;
};

export function HeaderBar({
  yearMonth,
  onYearMonthChange,
  onShow,
  onUploadFile,
  uploading = false,
  loading = false,
  statusText = null,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const downloadRef = useRef<HTMLAnchorElement>(null);
  const [exporting, setExporting] = useState(false);

  const handleExcelExport = async () => {
    if (!yearMonth) {
      toast.error("対象年月を選択してください");
      return;
    }

    setExporting(true);
    try {
      const fd = new FormData();
      fd.set("ym", yearMonth);
      
      const result = await balanceExportAction(fd);
      
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      // 複数ファイルを順次ダウンロード
      for (let i = 0; i < result.files.length; i++) {
        const file = result.files[i];
        const blob = new Blob(
          [Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))],
          { type: file.mime }
        );
        const url = URL.createObjectURL(blob);
        
        if (downloadRef.current) {
          downloadRef.current.href = url;
          downloadRef.current.download = file.name;
          downloadRef.current.click();
          
          // ダウンロード間に少し間隔を開ける
          if (i < result.files.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
          // メモリクリーンアップ
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        }
      }

      toast.success(
        `Excel出力完了: ${result.departmentCount}部門、合計${result.totalEntries}件のデータ`
      );
      
    } catch (error) {
      console.error("Excel export error:", error);
      toast.error("Excel出力でエラーが発生しました");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Label htmlFor="ym">対象年月</Label>
        <Input
          id="ym"
          type="month"
          value={yearMonth}
          onChange={(e) => onYearMonthChange(e.currentTarget.value)}
          className="w-[160px]"
          aria-label="対象年月を選択"
        />
        <Button onClick={onShow} variant="default" disabled={loading}>
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              表示
            </span>
          ) : (
            "表示"
          )}
        </Button>

        {/* ファイル選択は明示クリックのみ。年月未選択時は起動しない */}
        <input
          ref={fileRef}
          type="file"
          className="sr-only"
          aria-label="元帳Excelをアップロード"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) onUploadFile(f, yearMonth);
            if (fileRef.current) fileRef.current.value = ""; // 同一ファイル連続選択対応
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (!yearMonth) return; // 念のためのガード
            fileRef.current?.click();
          }}
          disabled={uploading}
          aria-busy={uploading}
        >
          {uploading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> アップロード中...
            </span>
          ) : (
            "Excelアップロード"
          )}
        </Button>
        {statusText && (
          <div
            className="ml-3 text-xs text-muted-foreground"
            aria-live="polite"
          >
            {statusText}
          </div>
        )}
      </div>

      <Button 
        variant="outline" 
        onClick={handleExcelExport}
        disabled={!yearMonth || exporting}
        aria-label="Excel形式で部門別にデータを出力"
      >
        {exporting ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Excel出力中...
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <Download className="h-4 w-4" />
            Excel出力
          </span>
        )}
      </Button>
      
      {/* 非表示のダウンロードリンク */}
      <a ref={downloadRef} className="hidden" aria-hidden />
    </div>
  );
}
