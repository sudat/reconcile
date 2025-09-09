"use client";

import { ReactNode } from "react";

type MenuItem = {
  key: string;
  label: string;
  onClick: () => void;
};

export function ContextMenuOverlay({
  x,
  y,
  onClose,
  items,
  children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  items?: MenuItem[];
  children?: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
      role="dialog"
      aria-modal
    >
      <div
        className="absolute min-w-40 rounded-md border bg-popover p-1 shadow-md"
        style={{ left: x + 4, top: y + 4 }}
        role="menu"
      >
        {items
          ? items.map((it) => (
              <button
                key={it.key}
                className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-accent"
                onClick={it.onClick}
              >
                {it.label}
              </button>
            ))
          : children}
      </div>
    </div>
  );
}

