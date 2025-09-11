/**
 * waitNeonReady (no-op)
 * 2025-09-11: Neon Warmupは不要になったため空実装に変更。
 * 呼び出し元の互換性維持のため型とシグネチャのみ残します。
 */
export async function waitNeonReady(
  _label: string,
  _opts: { maxWaitMs?: number; attempts?: number } = {}
) {
  return;
}
