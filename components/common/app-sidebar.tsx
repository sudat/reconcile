"use client";
import React from "react";
import {
  Home,
  File,
  Bookmark,
  SettingsIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarContent,
  SidebarFooter,
} from "@/components/ui/sidebar";
import NavMain from "@/components/common/nav-main";
import NavUser from "@/components/common/nav-user";
import Image from "next/image";
import Logo from "@/public/logo.png";

const data = {
  navMain: [
    {
      title: "Home",
      url: "/",
      icon: Home,
    },
    {
      title: "マスタ",
      url: "#",
      icon: SettingsIcon,
    },
    {
      title: "照合",
      url: "/reconcile",
      icon: File,
    },
    {
      title: "残高明細",
      url: "/balance-detail",
      icon: Bookmark,
    },
  ],
};
export default function AppSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <div className="flex items-center gap-2">
                <Image
                  src={Logo}
                  alt="logo"
                  width={30}
                  height={30}
                  className="object-contain"
                />
                <span className="text-base font-bold">Suda AI</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
