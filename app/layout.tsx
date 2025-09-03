import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import clsx from "clsx";
import "./globals.css";

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
        {children}
      </body>
    </html>
  );
}
