"use client";

import { useRef, useState } from "react";

type Award = {
  season: string;
  description: string;
  team?: string | null;
  award_type?: string | null;
};

type AwardsAccordionProps = {
  awards: Award[];
};

const AwardsAccordion = ({ awards }: AwardsAccordionProps) => {
  const [open, setOpen] = useState(false);
  const [maxHeight, setMaxHeight] = useState("0px");
  const containerRef = useRef<HTMLDivElement>(null);

  const handleToggle = () => {
    setOpen((prev) => {
      const next = !prev;
      const nextHeight = next ? `${containerRef.current?.scrollHeight ?? 0}px` : "0px";
      setMaxHeight(nextHeight);
      return next;
    });
  };

  return (
    <div className="mt-3 rounded-xl border border-[color:rgba(var(--color-app-foreground-rgb),0.15)] bg-[color:rgba(var(--color-app-foreground-rgb),0.02)] px-3 py-2">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer select-none items-center justify-center gap-2 text-sm font-semibold text-[color:var(--color-app-foreground)]"
      >
        <span>Full award log</span>
        <span aria-hidden="true">▼</span>
      </button>
      <div
        ref={containerRef}
        className="overflow-hidden transition-[max-height] duration-300 ease-in-out"
        style={{ maxHeight }}
      >
        <ul className="mt-3 max-h-64 space-y-3 overflow-y-auto pr-1 text-sm">
          {awards.map((award, index) => (
            <li
              key={`${award.season}-${award.description}-${index}`}
              className="flex items-start justify-between gap-3 rounded-xl border border-[color:rgba(var(--color-app-foreground-rgb),0.08)] bg-[color:rgba(var(--color-app-foreground-rgb),0.02)] px-3 py-2"
            >
              <div>
                <p className="font-semibold text-[color:var(--color-app-foreground)]">{award.description}</p>
                <p className="text-[0.7rem] uppercase tracking-[0.25em] text-[color:rgba(var(--color-app-foreground-rgb),0.55)]">
                  {award.season}
                  {award.team ? ` · ${award.team}` : ""}
                </p>
              </div>
              {award.award_type ? (
                <span className="shrink-0 rounded-full border border-[color:rgba(var(--color-app-foreground-rgb),0.15)] bg-[color:rgba(var(--color-app-foreground-rgb),0.04)] px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.3em] text-[color:rgba(var(--color-app-foreground-rgb),0.6)]">
                  {award.award_type}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default AwardsAccordion;
