"use client";

import type { ReactNode } from "react";

export function Collapsible({
  open,
  duration = 300,
  easing = "ease-in-out",
  children,
}: {
  open: boolean;
  duration?: number;
  easing?: string;
  children: ReactNode;
}) {
  return (
    <div
      aria-hidden={!open}
      className="grid overflow-hidden"
      style={{
        gridTemplateRows: open ? "1fr" : "0fr",
        transition: `grid-template-rows ${duration}ms ${easing}, opacity ${duration}ms ${easing}`,
        opacity: open ? 1 : 0,
      }}
    >
      <div className="min-h-0">{children}</div>
    </div>
  );
}
