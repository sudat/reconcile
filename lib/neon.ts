import { prisma } from "@/lib/prisma";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// 同時実行抑止: ウォームアップは単発化し、同時呼び出しを合流させる
let neonWarmup: Promise<void> | null = null;

/**
 * Neon のコールドスタート対策: 短い SELECT をリトライ。
 * 失敗例: ECONNRESET, connection closed, timeout など
 */
export async function waitNeonReady(
  label: string,
  opts: { maxWaitMs?: number; attempts?: number } = {}
) {
  // 既にウォームアップ中なら合流
  if (neonWarmup) {
    await neonWarmup;
    return;
  }
  neonWarmup = (async () => {
    const attempts = opts.attempts ?? 8; // 最大8回
    const maxWaitMs = opts.maxWaitMs ?? 60000; // ~60秒
    let delay = 150; // 初期待機
    const start = Date.now();
    for (let i = 0; i < attempts; i++) {
      try {
        // できるだけ軽いクエリ
        await prisma.$queryRawUnsafe("select 1");
        return; // OK
      } catch (e) {
        if (Date.now() - start > maxWaitMs) throw e;
        // 様子見:指数バックオフ（上限3s）
        await sleep(delay);
        delay = Math.min(Math.floor(delay * 1.8), 3000);
      }
    }
  })();
  try {
    await neonWarmup;
  } finally {
    neonWarmup = null;
  }
}
