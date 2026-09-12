"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import SearchCombobox from "@/components/SearchCombobox";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/teams", label: "Teams" },
  { href: "/players", label: "Players" },
  { href: "/scores", label: "Scores" },
  { href: "/news", label: "News" },
];

function getLastPlayerSearch(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return window.sessionStorage.getItem("lastPlayerSearch") ?? "";
  } catch {
    return "";
  }
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

  const segments = useMemo(() => pathname.split("/").filter(Boolean), [pathname]);
  const isPlayerProfile = segments[0] === "players" && segments.length >= 2;
  const queryParam = searchParams?.get("q") ?? "";
  const showSearch = pathname !== "/" && pathname !== "/signin" && pathname !== "/signup";
  const derivedQuery = useMemo(() => {
    if (!showSearch) {
      return "";
    }
    if (queryParam) {
      return queryParam;
    }
    if (isPlayerProfile) {
      const segment = segments[1] ?? "";
      if (/^\d+$/.test(segment)) {
        return "";
      }
      return decodeURIComponent(segment).replace(/-/g, " ");
    }
    return "";
  }, [showSearch, queryParam, isPlayerProfile, segments]);
  const [initialQuery, setInitialQuery] = useState(derivedQuery);

  useEffect(() => {
    const id = setTimeout(() => {
      let nextQuery = derivedQuery;
      if (showSearch && isPlayerProfile && !queryParam) {
        const storedQuery = getLastPlayerSearch();
        if (storedQuery) {
          nextQuery = storedQuery;
        }
      }
      setInitialQuery(nextQuery);
    }, 0);
    return () => clearTimeout(id);
  }, [derivedQuery, isPlayerProfile, queryParam, showSearch]);

  if (!showSearch) {
    return null;
  }

  return (
    <div className="flex w-full justify-center px-2 md:px-0">
      <SearchCombobox
        id="header-search"
        initialValue={initialQuery}
        placeholder="Search NBA players and teams"
        formClassName="w-full max-w-[26rem] md:max-w-[30rem]"
        fieldClassName="surface-card--elevated flex w-full items-center gap-3 rounded-full px-5 py-2 text-sm text-[var(--color-app-foreground)] focus-within:border-[color:var(--color-app-primary)] focus-within:ring-2 focus-within:ring-[var(--color-app-primary-soft)]"
        inputWrapperClassName="min-w-0 flex-1"
        inputClassName="h-9 w-full bg-transparent text-sm text-[var(--color-app-foreground)] placeholder:text-[color:var(--color-app-foreground-muted)] focus:outline-none"
        leadingButtonClassName="rounded-full p-1.5 text-[color:var(--color-app-primary)]/80 transition hover:bg-[color:var(--color-app-primary-soft)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-app-primary)] [&_svg]:h-4 [&_svg]:w-4"
        submitButtonClassName="btn-primary flex items-center justify-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold md:px-5 md:text-sm"
      />
    </div>
  );
}
