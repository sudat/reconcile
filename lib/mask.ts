// 表示専用: 支店名マスキング（KISS/DRY）
// 仕様:
// - 本社: 変更なし（"本社"）
// - 法人外商: "法人外xx"
// - "〜店": 先頭1文字 + "xx店"（例: 心斎橋店 → 心xx店）
// - 上記以外: 変更なし

export function maskBranchName(name: string): string {
  const n = String(name ?? "").trim();
  if (!n) return n;
  if (n === "本社") return n;
  if (n === "法人外商") return "法人外xx";

  if (n.endsWith("店") && n.length >= 2) {
    // 先頭1文字 + "xx店"
    const first = n[0];
    return `${first}xx店`;
  }

  return n;
}

