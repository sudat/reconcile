"use server";
import { waitNeonReady } from "@/lib/neon";

export async function neonWarmupAction() {
  try {
    // 環境変数のチェック
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is not set");
    }

    console.log("[Server Action] Starting Neon warmup...");
    await waitNeonReady("warmup-preflight");
    console.log("[Server Action] Neon warmup completed successfully");
    return { ok: true as const };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.error("[Server Action] Neon warmup failed:", errorMessage);

    return {
      ok: false as const,
      error: errorMessage,
    };
  }
}
