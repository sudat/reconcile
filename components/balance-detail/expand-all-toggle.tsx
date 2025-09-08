"use client";

import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronDown, ChevronUp } from "lucide-react";

type Props = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * 全案件の展開/折りたたみを切り替えるスイッチ。
 * - 視認性の高いピル型の小さなツールバーとして右上に置く想定。
 * - Shadcnの`Switch`と`Tooltip`のみを使用（YAGNI/KISS）。
 */
export function ExpandAllToggle({ checked, onCheckedChange, disabled, className }: Props) {
  return (
    <TooltipProvider>
      <div
        className={cn(
          "inline-flex items-center gap-2 rounded-full border bg-card/60 px-3 py-1.5 shadow-sm backdrop-blur",
          disabled && "opacity-50",
          className,
        )}
        aria-label="全案件をオープン/クローズにする"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2 select-none">
              {checked ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              )}
              <Label htmlFor="expand-all" className="text-xs text-foreground/80 cursor-pointer">
                全案件
              </Label>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end">
            <p className="text-xs">
              {checked ? "すべて展開中。クリックで全て閉じる" : "すべて閉じています。クリックで全て展開"}
            </p>
          </TooltipContent>
        </Tooltip>

        <Switch
          id="expand-all"
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          aria-label="案件明細の一括展開トグル"
        />
      </div>
    </TooltipProvider>
  );
}
