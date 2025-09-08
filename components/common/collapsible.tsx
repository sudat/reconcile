"use client";

import type { ReactNode } from "react";

export function Collapsible({
  open,
  duration = 240,
  children,
}: {
  open: boolean;
  duration?: number;
  children: ReactNode;
}) {
  return (
    <div
      aria-hidden={!open}
      className="grid overflow-hidden"
      style={{
        gridTemplateRows: open ? "1fr" : "0fr",
        transition: `grid-template-rows ${duration}ms ease, opacity ${duration}ms ease`,
        opacity: open ? 1 : 0,
      }}
    >
      <div className="min-h-0">{children}</div>
    </div>
  );
}

