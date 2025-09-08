import Link from "next/link";

export default function Home() {
  return (
    <main className="container mx-auto p-6 font-normal">
      <Link href="/reconcile">照合</Link>
      <Link href="/balance-detail">残高明細</Link>
    </main>
  );
}
