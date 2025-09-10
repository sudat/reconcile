import { PrismaClient } from "@prisma/client";

// Prevent hot-reload from creating multiple clients in dev
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Console出力ではなくイベントで受け取り、ファイルへも書き出す
    log:
      process.env.NODE_ENV === "development"
        ? [
            { emit: "event", level: "query" },
            { emit: "event", level: "warn" },
            { emit: "event", level: "error" },
          ]
        : [{ emit: "event", level: "error" }],
    // 接続プールタイムアウト設定
    datasourceUrl: process.env.DATABASE_URL,
  });

// Prismaログをterminal.logへも出力（Terminalと同レベルの可観測性）
// Note: イベントリスナーは型安全性のため一時的に無効化

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
