"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

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

export default function HeaderNavCluster({ className }: { className?: string }) {
  return (
    <nav
      className={cn(
        "flex w-full flex-wrap items-center justify-center gap-6 text-sm text-[color:var(--color-app-foreground-muted)] md:absolute md:left-1/2 md:top-1/2 md:w-auto md:-translate-x-1/2 md:-translate-y-1/2 md:flex-nowrap",
        className,
      )}
    >
      {NAV_LINKS.map((link) => (
        <Link key={link.href} href={link.href} className="transition hover:text-[var(--color-app-foreground)]">
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export function HeaderSearchBar() {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const router = useRouter();

  const segments = useMemo(() => pathname.split("/").filter(Boolean), [pathname]);
  const isPlayerProfile = segments[0] === "players" && segments.length >= 2;
  const queryParam = searchParams?.get("q") ?? "";
  const [storedQuery, setStoredQuery] = useState("");
  const showSearch =
    pathname !== "/" && pathname !== "/players" && pathname !== "/signin" && pathname !== "/signup";
  const derivedQuery = useMemo(() => {
    if (!showSearch) {
      return "";
    }
    if (queryParam) {
      return queryParam;
    }
    if (isPlayerProfile) {
      if (storedQuery) {
        return storedQuery;
      }
      const segment = segments[1] ?? "";
      if (/^\d+$/.test(segment)) {
        return "";
      }
      return decodeURIComponent(segment).replace(/-/g, " ");
    }
    return "";
  }, [showSearch, queryParam, isPlayerProfile, segments, storedQuery]);
  const [query, setQuery] = useState(derivedQuery);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        setStoredQuery(window.sessionStorage.getItem("lastPlayerSearch") ?? "");
      } catch {
        setStoredQuery("");
      }
    }
    const id = setTimeout(() => setQuery(derivedQuery), 0);
    return () => clearTimeout(id);
  }, [derivedQuery, pathname]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const slug = normalizeSlug(query);
    if (!slug) {
      return;
    }
    const rawQuery = query.trim();
    if (rawQuery && typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem("lastPlayerSearch", rawQuery);
      } catch {
        // ignore storage errors
      }
    }
    startTransition(() => {
      router.push(`/players/${encodeURIComponent(slug)}`);
    });
  };

  if (!showSearch) {
    return null;
  }

  return (
    <div className="flex w-full justify-center px-2 md:px-0">
      <form
        onSubmit={handleSubmit}
        className="surface-card--elevated flex w-full max-w-[26rem] items-center gap-3 rounded-full px-5 py-2 text-sm text-[var(--color-app-foreground)] focus-within:border-[color:var(--color-app-primary)] focus-within:ring-2 focus-within:ring-[var(--color-app-primary-soft)] md:max-w-[30rem]"
        role="search"
      >
        <label className="sr-only" htmlFor="header-search">
          Search players
        </label>
        <button
          type="submit"
          aria-label="Submit search"
          className="rounded-full p-1.5 text-[color:var(--color-app-primary)]/80 transition hover:bg-[color:var(--color-app-primary-soft)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-app-primary)]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35m1.6-5.4a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
          </svg>
        </button>
        <input
          id="header-search"
          type="search"
          placeholder="Search the league (players, teams...)"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-9 flex-1 bg-transparent text-sm text-[var(--color-app-foreground)] placeholder:text-[color:var(--color-app-foreground-muted)] focus:outline-none"
        />
        <button
          type="submit"
          className="btn-primary flex items-center justify-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold md:px-5 md:text-sm"
        >
          {isPending && (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
          )}
          <span className="text-background">{isPending ? "Loading" : "Search"}</span>
        </button>
      </form>
    </div>
  );
}
