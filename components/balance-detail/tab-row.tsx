"use client";

type TabItem = { id: string; label: string };

export function TabRow({
  items,
  activeId,
  onChange,
  ariaLabel,
  size = "md",
}: {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  size?: "md" | "sm";
}) {
  return (
    <div className="overflow-x-auto">
      <div className="w-max min-w-full">
        <div
          role="tablist"
          aria-label={ariaLabel}
          className="flex items-end gap-2 border-b"
        >
          {items.map((t) => {
            const active = t.id === activeId;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => onChange(t.id)}
                className={[
                  "px-3 font-normal text-sm -mb-px border-b-2 transition-colors",
                  size === "sm" ? "h-8" : "h-10",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                ].join(" ")}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

