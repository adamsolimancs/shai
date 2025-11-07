'use client';

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import TextType from "@/components/TextType";

const trendingTerms = [
  "Victor Wembanyama",
  "Warriors vs Lakers",
  "MVP Ladder",
  "League Leaders",
  "Jalen Brunson",
  "Celtics Defensive Rating",
  "Jokic Triple Double",
  "Thunder Playoff Odds",
  "Anthony Edwards Highlights",
  "Knicks Injury Report",
  "Steph Curry Splits",
  "Heat Zone Defense",
  "LeBron 40k Points",
  "Pacers Pace Stats",
  "Giannis Shot Chart",
  "2025 Rookie of the Year",
  "Spurs Head Coach",
];

const normalizeQuery = (input: string) =>
  input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export default function HeroSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hasInteracted, setHasInteracted] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = normalizeQuery(query);
    if (!normalized) return;
    router.push(`/players/${encodeURIComponent(normalized)}`);
  };

  const showTypewriter = !hasInteracted && query.length === 0;

  return (
    <form className="mx-auto w-full max-w-3xl" onSubmit={handleSubmit}>
      <label htmlFor="global-search" className="sr-only">
        Search players
      </label>
      <div className="surface-card--elevated flex items-center gap-3 rounded-full px-6 py-3 focus-within:border-[color:var(--color-app-primary)] focus-within:ring-2 focus-within:ring-[var(--color-app-primary-soft)]">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-5 w-5 text-[color:var(--color-app-primary)]/70"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35m1.6-5.4a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
        </svg>
        <div className="relative flex-1">
          <input
            id="global-search"
            type="search"
            aria-label="Search players, teams, matchups, or stats"
            className="h-10 w-full bg-transparent text-base text-[var(--color-app-foreground)] focus:outline-none"
            value={query}
            onFocus={() => setHasInteracted(true)}
            onChange={(event) => {
              if (!hasInteracted) setHasInteracted(true);
              setQuery(event.target.value);
            }}
          />
          {showTypewriter && (
            <TextType
              text={trendingTerms}
              typingSpeed={55}
              pauseDuration={2500}
              cursorCharacter="_"
              className="pointer-events-none absolute left-10 top-1/2 -translate-y-1/2 text-base text-[color:var(--color-app-foreground-muted)]"
            />
          )}
        </div>
        <button type="submit" className="btn-primary rounded-full px-5 py-2 text-sm font-semibold">
          Search
        </button>
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-3 text-xs text-[color:var(--color-app-foreground-muted)]">
      </div>
    </form>
  );
}
