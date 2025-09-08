export function formatJPY(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
  }).format(value);
}

export function formatDateJP(isoLike: string) {
  // YYYY-MM-DD → YYYY/MM/DD の簡易整形
  const d = new Date(isoLike);
  if (!Number.isNaN(d.getTime())) {
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
    ].join("/");
  }
  return isoLike;
}

