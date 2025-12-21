"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type PlayerProfileSearchProps = {
  initialValue?: string;
};

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function PlayerProfileSearch({ initialValue = "" }: PlayerProfileSearchProps) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const slug = slugify(value);
    if (!slug) {
      return;
    }
    startTransition(() => {
      router.push(`/players/${encodeURIComponent(slug)}`);
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-4 rounded-3xl border border-white/10 bg-slate-950/40 p-6 md:grid-cols-[2fr_auto]"
    >
      <label className="sr-only" htmlFor="player-profile-search">
        Search players
      </label>
      <input
        id="player-profile-search"
        type="search"
        placeholder="Jump to a player (ex: Jalen Brunson)"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="rounded-2xl border border-white/10 bg-transparent px-4 py-2.5 text-sm text-white placeholder:text-white/50 focus:border-white/40 focus:outline-none"
      />
      <button type="submit" className="btn-primary flex items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-semibold">
        {isPending && (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
        )}
        <span className="text-background">{isPending ? "Loading" : "Search"}</span>
      </button>
    </form>
  );
}
