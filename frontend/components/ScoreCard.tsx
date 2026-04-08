import Link from "next/link";
import type { ReactNode } from "react";
import { isFinalStatus } from "@/lib/gameUtils";

type TeamScore = {
  name?: string | null;
  score?: number | null;
};

export type ScoreCardProps = {
  href?: string;
  prefetch?: boolean;
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
  prefetch = false,
  className = "",
}: ScoreCardProps) {
  const isLanding = variant === "landing";
  const isCompact = density === "compact";
  const resolvedIsFinal = typeof isFinal === "boolean" ? isFinal : isFinalStatus(status);
  const losingTeam = resolvedIsFinal && winner !== "even" ? (winner === "home" ? "away" : "home") : null;
  const losingTone = isLanding ? "opacity-60 text-[color:var(--color-app-foreground-muted)]" : "opacity-55 text-white/60";
  const outerClasses = isLanding
    ? `group block rounded-3xl border border-[color:var(--color-app-border)] bg-linear-to-br from-[color:var(--color-app-background-soft)] via-[color:var(--color-app-surface)] to-[color:var(--color-app-surface-soft)] ${isCompact ? "p-3 sm:p-4" : "p-4 sm:p-5"} text-[color:var(--color-app-foreground)] shadow-lg shadow-black/5 transition-all hover:border-[color:var(--color-app-border-strong)] hover:from-[color:rgba(var(--color-app-primary-rgb)_/_0.05)] hover:via-[color:rgba(var(--color-app-primary-rgb)_/_0.08)] hover:to-[color:rgba(var(--color-app-primary-light-rgb)_/_0.12)] hover:shadow-black/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-app-primary-soft)]`
    : "rounded-3xl border border-white/10 bg-slate-950/60 p-5 text-white shadow-lg shadow-black/30 transition hover:border-white/20 hover:bg-slate-900/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20";

  const meta = isLanding ? (
    <div className={`flex flex-col ${isCompact ? "gap-0.5" : "gap-1"} text-[0.6rem] uppercase tracking-[0.25em] text-[color:var(--color-app-foreground-muted)] sm:flex-row sm:items-center sm:justify-between sm:text-[0.65rem] sm:tracking-[0.3em]`}>
      <span className={`${isCompact ? "text-xs sm:text-sm" : "text-sm sm:text-base"} font-semibold normal-case tracking-normal text-[color:var(--color-app-foreground)]`}>
        {timeLabel ?? "Tipoff TBA"}
      </span>
      {locationLabel ? (
        <p
          className={`${isCompact ? "text-[0.55rem] sm:text-[0.6rem]" : "text-[0.6rem] sm:text-[0.65rem]"} max-w-[12rem] truncate font-medium uppercase tracking-[0.2em] text-[color:var(--color-app-foreground-muted)] sm:max-w-[16rem]`}
          title={locationLabel}
        >
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
    ? `flex min-w-0 items-center justify-between gap-3 ${isCompact ? "rounded-xl px-3 py-2 sm:px-4 sm:py-2.5" : "rounded-2xl px-4 py-3 sm:px-5 sm:py-3.5"} border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-soft)] transition group-hover:border-[color:var(--color-app-border-strong)] group-hover:bg-[color:var(--color-app-background-soft)]`
    : "flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white transition";

  const awayRowTone = `${rowBase} ${losingTeam === "away" ? losingTone : ""}`;
  const homeRowTone = `${rowBase} ${losingTeam === "home" ? losingTone : ""}`;

  const renderTeamRow = (team: TeamScore, tone: string, fallback: string) => {
    const score = Number.isFinite(team.score ?? NaN) ? team.score : "—";
    return (
      <div className={tone}>
        <span className="min-w-0 flex-1 truncate pr-3" title={team.name ?? fallback}>
          {team.name ?? fallback}
        </span>
        <span className="shrink-0 tabular-nums">{score}</span>
      </div>
    );
  };

  const rows = (
    <div
      className={`${
        isCompact
          ? "mt-3 space-y-2 text-sm sm:mt-4 sm:space-y-3 sm:text-base"
          : "mt-4 space-y-3 text-base sm:mt-5 sm:space-y-4 sm:text-lg"
      } font-semibold`}
    >
      {renderTeamRow(away, awayRowTone, "Away")}
      {renderTeamRow(home, homeRowTone, "Home")}
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
      <Link href={href} prefetch={prefetch} className={`${outerClasses} ${className}`}>
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
