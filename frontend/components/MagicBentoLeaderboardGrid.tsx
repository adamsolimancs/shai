"use client";

import Link from "next/link";
import { gsap } from "gsap";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import "./MagicBentoLeaderboardGrid.css";

type LeaderboardRow = {
  player_id: number;
  rank: number;
  player_name: string;
  team_abbreviation: string | null;
  stat_value: number;
};

type Leaderboard = {
  id: string;
  label: string;
  metric: string;
  digits?: number;
  rows: LeaderboardRow[];
};

type MagicBentoLeaderboardGridProps = {
  leaderboards: Leaderboard[];
  className?: string;
};

function formatNumber(value: number, digits = 1) {
  return value.toFixed(digits);
}

export default function MagicBentoLeaderboardGrid({
  leaderboards,
  className,
}: MagicBentoLeaderboardGridProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const supportsHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (prefersReducedMotion || !supportsHover) {
      return;
    }

    const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-magic-bento-card]"));
    const cleanups = cards.map((card) => {
      const sheen = card.querySelector<HTMLElement>("[data-magic-bento-sheen]");

      const handlePointerEnter = () => {
        card.style.setProperty("--magic-bento-glow-opacity", "1");
        gsap.to(card, {
          scale: 1.01,
          duration: 0.25,
          ease: "power2.out",
          overwrite: true,
        });
      };

      const handlePointerMove = (event: PointerEvent) => {
        const rect = card.getBoundingClientRect();
        const offsetX = event.clientX - rect.left;
        const offsetY = event.clientY - rect.top;
        const relativeX = (offsetX / rect.width) * 100;
        const relativeY = (offsetY / rect.height) * 100;
        const rotateX = ((offsetY - rect.height / 2) / rect.height) * -8;
        const rotateY = ((offsetX - rect.width / 2) / rect.width) * 10;

        card.style.setProperty("--magic-bento-glow-x", `${relativeX}%`);
        card.style.setProperty("--magic-bento-glow-y", `${relativeY}%`);

        gsap.to(card, {
          rotateX,
          rotateY,
          x: (offsetX - rect.width / 2) * 0.018,
          y: (offsetY - rect.height / 2) * 0.018,
          duration: 0.18,
          ease: "power2.out",
          overwrite: true,
          transformPerspective: 1200,
        });

        if (sheen) {
          gsap.to(sheen, {
            x: (offsetX - rect.width / 2) * 0.035,
            y: (offsetY - rect.height / 2) * 0.035,
            duration: 0.22,
            ease: "power2.out",
            overwrite: true,
          });
        }
      };

      const handlePointerLeave = () => {
        card.style.setProperty("--magic-bento-glow-opacity", "0");
        gsap.to(card, {
          scale: 1,
          rotateX: 0,
          rotateY: 0,
          x: 0,
          y: 0,
          duration: 0.32,
          ease: "power3.out",
          overwrite: true,
        });

        if (sheen) {
          gsap.to(sheen, {
            x: 0,
            y: 0,
            duration: 0.32,
            ease: "power3.out",
            overwrite: true,
          });
        }
      };

      card.addEventListener("pointerenter", handlePointerEnter);
      card.addEventListener("pointermove", handlePointerMove);
      card.addEventListener("pointerleave", handlePointerLeave);

      return () => {
        card.removeEventListener("pointerenter", handlePointerEnter);
        card.removeEventListener("pointermove", handlePointerMove);
        card.removeEventListener("pointerleave", handlePointerLeave);
        gsap.killTweensOf(card);
        if (sheen) {
          gsap.killTweensOf(sheen);
        }
      };
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [leaderboards.length]);

  return (
    <div
      ref={rootRef}
      className={cn(
        "grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5",
        className,
      )}
    >
      {leaderboards.map((board) => {
        return (
          <article
            key={board.id}
            data-magic-bento-card
            className={cn(
              "magic-bento-card relative min-h-[14.5rem] overflow-hidden rounded-[1.6rem] border border-white/10 bg-slate-950/75 p-4 text-white shadow-[0_14px_40px_rgba(2,6,23,0.28)]",
            )}
          >
            <div className="magic-bento-card__sheen" data-magic-bento-sheen aria-hidden="true" />
            <div className="magic-bento-card__mesh" aria-hidden="true" />

            <div className="relative z-10 flex h-full flex-col">
              <h3 className="text-lg font-semibold tracking-tight text-white">{board.label}</h3>

              {board.rows.length > 0 ? (
                <ol className="mt-4 grid gap-2">
                  {board.rows.map((row, index) => (
                    <li key={row.player_id}>
                      <Link
                        href={`/players/${encodeURIComponent(String(row.player_id))}`}
                        className="flex items-center gap-3 rounded-[1rem] border border-white/8 bg-black/20 px-3.5 py-3 transition duration-200 hover:border-white/16 hover:bg-black/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                      >
                        <span className="magic-bento-card__rank flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 text-sm font-semibold">
                          {row.rank || index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[0.95rem] font-medium text-white">
                          {row.player_name}
                        </span>
                        <span className="shrink-0 text-sm font-semibold text-white/72">
                          {formatNumber(row.stat_value, board.digits ?? 1)} {board.metric}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="mt-4 rounded-[1.3rem] border border-dashed border-white/10 bg-black/15 px-4 py-6 text-sm leading-6 text-white/55">
                  No leaderboard entries are available for this split yet.
                </div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
