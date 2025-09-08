"use client";
import React from "react";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Check } from "lucide-react";

type Company = {
  id: string;
  code: "CM" | "DM" | "PRC";
  name: string;
};

const companies: Company[] = [
  { id: "common", code: "CM", name: "全社共通" },
  { id: "dm", code: "DM", name: "DM 株式会社" },
  { id: "prc", code: "PRC", name: "PRC 株式会社" },
];

export default function NavUser() {
  const [selected, setSelected] = React.useState<Company>(companies[0]);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="cursor-pointer">
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg text-[11px] font-bold">
                  {selected.code}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{selected.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  データ対象: {selected.code}
                </span>
              </div>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="px-1 py-1.5 text-left text-sm">
                <div className="font-medium">テナントを選択</div>
                <div className="text-xs text-muted-foreground">
                  現在: {selected.name}（{selected.code}）
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={selected.id}
              onValueChange={(value) => {
                const next = companies.find((c) => c.id === value);
                if (next) setSelected(next);
              }}
            >
              {companies.map((c) => (
                <DropdownMenuRadioItem key={c.id} value={c.id}>
                  <Avatar className="size-6 rounded-md">
                    <AvatarFallback className="rounded-md text-[10px] font-bold">
                      {c.code}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="text-sm">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.code}
                    </div>
                  </div>
                  {selected.id === c.id && (
                    <Check className="size-4 text-primary" />
                  )}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
