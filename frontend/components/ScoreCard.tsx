import Link from "next/link";
import type { ReactNode } from "react";
import { isFinalStatus } from "@/lib/gameUtils";

type TeamScore = {
  name?: string | null;
  score?: number | null;
};

export type ScoreCardProps = {
  href?: string;
  variant?: "landing" | "scoreboard";
  density?: "regular" | "compact";
  timeLabel?: ReactNode;
  locationLabel?: string;
  status?: string | null;
  isFinal?: boolean;
  footerLabel?: string;
  winner?: "home" | "away" | "even";
  home: TeamScore;
  away: TeamScore;
  className?: string;
};

export default function ScoreCard({
  href,
  variant = "landing",
  density = "regular",
  timeLabel,
  locationLabel,
  status,
  isFinal,
  footerLabel,
  winner = "even",
  home,
  away,
  className = "",
}: ScoreCardProps) {
  const isLanding = variant === "landing";
  const isCompact = density === "compact";
  const resolvedIsFinal = typeof isFinal === "boolean" ? isFinal : isFinalStatus(status);
  const losingTeam = resolvedIsFinal && winner !== "even" ? (winner === "home" ? "away" : "home") : null;
  const losingTone = isLanding ? "opacity-60 text-[color:var(--color-app-foreground-muted)]" : "opacity-55 text-white/60";
  const outerClasses = isLanding
    ? `group block rounded-3xl border border-[color:var(--color-app-border)] bg-linear-to-br from-[color:var(--color-app-background-soft)] via-[color:var(--color-app-surface)] to-[color:var(--color-app-surface-soft)] ${isCompact ? "p-2 sm:p-3" : "p-3 sm:p-5"} text-[color:var(--color-app-foreground)] shadow-lg shadow-black/5 transition-all hover:border-[color:var(--color-app-border-strong)] hover:from-[color:rgba(var(--color-app-primary-rgb)_/_0.05)] hover:via-[color:rgba(var(--color-app-primary-rgb)_/_0.08)] hover:to-[color:rgba(var(--color-app-primary-light-rgb)_/_0.12)] hover:shadow-black/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-app-primary-soft)]`
    : "rounded-3xl border border-white/10 bg-slate-950/60 p-5 text-white shadow-lg shadow-black/30 transition hover:border-white/20 hover:bg-slate-900/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20";

  const meta = isLanding ? (
    <div className={`flex flex-col ${isCompact ? "gap-0.5" : "gap-1"} text-[0.6rem] uppercase tracking-[0.25em] text-[color:var(--color-app-foreground-muted)] sm:flex-row sm:items-center sm:justify-between sm:text-[0.65rem] sm:tracking-[0.3em]`}>
      <span className={`${isCompact ? "text-xs sm:text-sm" : "text-sm sm:text-base"} font-semibold normal-case tracking-normal text-[color:var(--color-app-foreground)]`}>
        {timeLabel ?? "Tipoff TBA"}
      </span>
      {locationLabel ? (
        <p className={`${isCompact ? "text-[0.55rem] sm:text-[0.6rem]" : "text-[0.6rem] sm:text-[0.65rem]"} font-medium uppercase tracking-[0.2em] text-[color:var(--color-app-foreground-muted)]`}>
          {locationLabel}
        </p>
      ) : null}
    </div>
  ) : (
    <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-white/40">
      <span>{timeLabel ?? ""}</span>
      {status ? <span className="text-white/70">{status}</span> : null}
    </div>
  );

  const rowBase = isLanding
    ? `flex items-center justify-between ${isCompact ? "rounded-xl px-2 py-1.5 sm:px-3 sm:py-2" : "rounded-2xl px-3 py-2 sm:px-4 sm:py-3"} border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-soft)] transition group-hover:border-[color:var(--color-app-border-strong)] group-hover:bg-[color:var(--color-app-background-soft)]`
    : "flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white transition";

  const awayRowTone = `${rowBase} ${losingTeam === "away" ? losingTone : ""}`;
  const homeRowTone = `${rowBase} ${losingTeam === "home" ? losingTone : ""}`;

  const rows = (
    <div className={`${isCompact ? "mt-2 space-y-1.5 text-sm sm:mt-3 sm:space-y-2 sm:text-base" : "mt-3 space-y-2 text-base sm:mt-4 sm:space-y-3 sm:text-lg"} font-semibold`}>
      <div className={awayRowTone}>
        <span>{away.name ?? "Away"}</span>
        <span>{Number.isFinite(away.score ?? NaN) ? away.score : "—"}</span>
      </div>
      <div className={homeRowTone}>
        <span>{home.name ?? "Home"}</span>
        <span>{Number.isFinite(home.score ?? NaN) ? home.score : "—"}</span>
      </div>
    </div>
  );

  const footer = footerLabel ? (
    <p className={isLanding ? "mt-3 text-xs uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)]" : "mt-4 text-xs uppercase tracking-[0.3em] text-white/50"}>
      {footerLabel}
    </p>
  ) : null;

  const content = (
    <>
      {meta}
      {rows}
      {footer}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`${outerClasses} ${className}`}>
        {content}
      </Link>
    );
  }

  return (
    <div className={`${outerClasses} ${className}`}>
      {content}
    </div>
  );
}
