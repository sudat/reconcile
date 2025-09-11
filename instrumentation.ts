// Next.js instrumentation hook
// NodeランタイムでのみConsole→ファイル書き出しを初期化する
export async function register() {
  // Edge等ではfsが使えないため回避
  if (typeof process !== "undefined" && process.versions?.node) {
    try {
      const mod = await import("./lib/logger");
      mod.initServerLogging?.();

      // NodeのWarningイベントをフックしてスタックを常時出力（重複登録ガード）
      const g = globalThis as unknown as { __warningTraceInstalled?: boolean };
      if (!g.__warningTraceInstalled) {
        try {
          process.on("warning", (w: Error & { code?: string | number }) => {
            const name = w?.name ?? "Warning";
            const code = w && "code" in w && w.code ? String(w.code) : "";
            const header = `[NodeWarning][${name}${code ? ":" + code : ""}] ${w?.message ?? ""}`;
            const stack = typeof w?.stack === "string" ? w.stack : String(w ?? "");
            // 警告はerrorレベルでまとめて出す（Terminal上で見やすく）
            console.error(`${header}\n${stack}`);
          });
          g.__warningTraceInstalled = true;
        } catch {}
      }
    } catch {
      // 初期化失敗時は黙殺（アプリ動作を阻害しない）
      console.log("[SYSTEM] Server logging failed to initialize");
    }
  }
}
