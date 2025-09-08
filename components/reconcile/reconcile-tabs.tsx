"use client";

import { useState } from "react";
import { TabRow } from "@/components/balance-detail/tab-row";

export function ReconcileTabs({
  tb,
  gl,
}: {
  tb: React.ReactNode;
  gl: React.ReactNode;
}) {
  const tabs = [
    { id: "tb", label: "本支店照合TB" },
    { id: "gl", label: "本支店照合GL" },
  ] as const;

  const [active, setActive] = useState<(typeof tabs)[number]["id"]>("tb");

  return (
    <div className="font-normal">
      <TabRow
        items={tabs.map((t) => ({ id: t.id, label: t.label }))}
        activeId={active}
        onChange={(id) => setActive(id as typeof tabs[number]["id"])}
        ariaLabel="照合種別タブ"
      />

      <div className="h-4" />
      {/* タブのメインエリア: 両方マウントして表示のみ切替（状態保持） */}
      <div
        role="tabpanel"
        aria-hidden={active !== "tb"}
        className={active === "tb" ? "block" : "hidden"}
      >
        {tb}
      </div>
      <div
        role="tabpanel"
        aria-hidden={active !== "gl"}
        className={active === "gl" ? "block" : "hidden"}
      >
        {gl}
      </div>
    </div>
  );
}
