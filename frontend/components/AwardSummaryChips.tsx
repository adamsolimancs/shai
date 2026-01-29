"use client";

import { useMemo, useState } from "react";

type AwardSummaryItem = {
  label: string;
  count: number;
  seasons?: string[];
};

const AwardSummaryChips = ({ items }: { items: AwardSummaryItem[] }) => {
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const activeItem = useMemo(
    () => items.find((item) => item.label === activeLabel) ?? null,
    [items, activeLabel],
  );

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const isActive = activeLabel === item.label;
          const seasonLabel = item.seasons?.length === 1 ? "Season" : "Seasons";
          const ariaLabel =
            item.seasons?.length
              ? `${item.label} ${seasonLabel.toLowerCase()}: ${item.seasons.join(", ")}`
              : `${item.label} x${item.count}`;
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => setActiveLabel((prev) => (prev === item.label ? null : item.label))}
              className={`inline-flex cursor-pointer items-center gap-1 rounded-full border border-[color:rgba(var(--color-app-foreground-rgb),0.15)] bg-[color:rgba(var(--color-app-foreground-rgb),0.05)] px-3 py-1 text-[0.75rem] font-medium text-[color:var(--color-app-foreground)] transition ${
                isActive
                  ? "border-[color:rgba(var(--color-app-primary-rgb),0.55)] bg-[color:rgba(var(--color-app-primary-rgb),0.12)]"
                  : "hover:border-[color:rgba(var(--color-app-foreground-rgb),0.3)]"
              }`}
              title={item.seasons?.length ? `${seasonLabel}: ${item.seasons.join(", ")}` : undefined}
              aria-label={ariaLabel}
            >
              {item.label}
              <span className="text-[color:var(--color-app-foreground-muted)]">x{item.count}</span>
            </button>
          );
        })}
      </div>
      {activeItem?.seasons?.length ? (
        <div className="mt-2 rounded-xl border border-[color:rgba(var(--color-app-foreground-rgb),0.18)] bg-[color:rgba(var(--color-app-foreground-rgb),0.05)] px-3 py-2 text-[0.7rem] uppercase tracking-[0.2em] text-[color:rgba(var(--color-app-foreground-rgb),0.65)]">
          <span className="font-semibold text-[color:var(--color-app-foreground)]">
            {activeItem.label === "Rings"
              ? activeItem.seasons.length === 1
                ? "Championship season"
                : "Championship seasons"
              : `${activeItem.label} ${activeItem.seasons.length === 1 ? "season" : "seasons"}`}
          </span>
          {" · "}
          {activeItem.seasons.join(", ")}
        </div>
      ) : null}
    </div>
  );
};

export default AwardSummaryChips;
