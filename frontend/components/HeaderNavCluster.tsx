"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const NAV_LINKS = [
  { href: "/teams", label: "Teams" },
  { href: "/players", label: "Players" },
  { href: "/scores", label: "Scores" },
  { href: "/news", label: "News" },
];

function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function HeaderNavCluster() {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState("");

  const segments = useMemo(() => pathname.split("/").filter(Boolean), [pathname]);
  const isPlayerProfile = segments[0] === "players" && segments.length >= 2;
  const queryParam = searchParams?.get("q") ?? "";
  const showSearch = pathname !== "/" && pathname !== "/players";

  useEffect(() => {
    if (!showSearch) {
      setQuery("");
      return;
    }
    if (queryParam) {
      setQuery(queryParam);
      return;
    }
    if (isPlayerProfile) {
      setQuery(decodeURIComponent(segments[1] ?? "").replace(/-/g, " "));
      return;
    }
    setQuery("");
  }, [showSearch, queryParam, isPlayerProfile, segments]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const slug = normalizeSlug(query);
    if (!slug) {
      return;
    }
    router.push(`/players/${encodeURIComponent(slug)}`);
  };

  const stackSpacing = showSearch ? "gap-2" : "gap-2 pt-4";

  return (
    <div className={`flex flex-col items-center ${stackSpacing} md:pointer-events-auto`}>
      <nav className="flex w-full flex-wrap items-center justify-center pb-2 gap-6 text-sm text-[color:var(--color-app-foreground-muted)]">
        {NAV_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="transition hover:text-[var(--color-app-foreground)]">
            {link.label}
          </Link>
        ))}
      </nav>
      {showSearch && (
        <form
          onSubmit={handleSubmit}
          className="flex w-full max-w-[22rem] items-center gap-2 rounded-full border border-white/10 bg-[color:var(--color-app-surface-soft)] px-4 py-2 text-xs text-white md:max-w-[28rem] md:text-sm"
          role="search"
        >
          <label className="sr-only" htmlFor="header-search">
            Search players
          </label>
          <input
            id="header-search"
            type="search"
            placeholder="Search the league (players, teams...)"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="flex-1 bg-transparent text-xs text-white placeholder:text-white/60 focus:outline-none md:text-sm"
          />
          <button
            type="submit"
            className="rounded-full border border-white/30 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.35em] text-white transition hover:border-white/70 md:px-4 md:py-1.5 md:text-xs"
          >
            Go
          </button>
        </form>
      )}
    </div>
  );
}
