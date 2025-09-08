import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import clsx from "clsx";
import "./globals.css";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SidebarInset } from "@/components/ui/sidebar";
import AppSidebar from "@/components/common/app-sidebar";

const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-noto-sans-jp",
});

export const metadata: Metadata = {
  title: "Reconcile App",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={clsx(notoSansJP.variable, "font-sans", "font-normal")}
      >
        <SidebarProvider>
          <AppSidebar variant="inset" />
          <SidebarInset className="p-8">{children}</SidebarInset>
        </SidebarProvider>
      </body>
    </html>
  );
}
