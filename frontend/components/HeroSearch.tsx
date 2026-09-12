"use client";

import { useMemo } from "react";

import SearchCombobox from "@/components/SearchCombobox";
import TextType from "@/components/TextType";

const trendingTerms = [
  "Victor Wembanyama",
  "Jalen Brunson",
  "Anthony Edwards",
  "Stephen Curry",
  "LeBron James",
  "Shai Gilgeous-Alexander",
  "Nikola Jokic",
  "Giannis Antetokounmpo",
  "Luka Doncic",
  "Jayson Tatum",
  "Kevin Durant",
  "Devin Booker",
  "Donovan Mitchell",
  "Tyrese Haliburton",
  "Ja Morant",
  "Paolo Banchero",
  "Cade Cunningham",
];

function shuffleList(list: string[]): string[] {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export default function HeroSearch() {
  const randomTrendingTerms = useMemo(() => shuffleList(trendingTerms), []);

  return (
    <SearchCombobox
      id="global-search"
      formClassName="mx-auto w-full max-w-3xl"
      fieldClassName="surface-card--elevated flex items-center gap-3 rounded-full px-6 py-3 focus-within:border-[color:var(--color-app-primary)] focus-within:ring-2 focus-within:ring-[var(--color-app-primary-soft)]"
      inputWrapperClassName="flex-1"
      inputClassName="h-10 w-full bg-transparent text-base text-[var(--color-app-foreground)] focus:outline-none"
      leadingButtonClassName="rounded-full p-1 text-[color:var(--color-app-primary)]/70 transition hover:bg-[color:var(--color-app-primary-soft)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-app-primary)]"
      submitButtonClassName="btn-primary flex items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-semibold"
      idleContent={
        <TextType
          text={randomTrendingTerms}
          typingSpeed={55}
          pauseDuration={2500}
          cursorCharacter="_"
          className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 text-sm text-[color:var(--color-app-foreground-muted)] sm:left-2 sm:text-base"
        />
      }
    />
  );
}
