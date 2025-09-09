"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

type Props = {
  yearMonth: string; // "YYYY-MM"
  onYearMonthChange: (ym: string) => void;
  onShow: () => void;
  onUploadFile: (file: File, ym: string) => void;
  uploading?: boolean;
};

export function HeaderBar({
  yearMonth,
  onYearMonthChange,
  onShow,
  onUploadFile,
  uploading = false,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

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
        <Button onClick={onShow} variant="default">
          表示
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
      </div>

      <Button variant="outline" disabled>
        Excel 出力（準備中）
      </Button>
    </div>
  );
}
