import Link from "next/link";

type TeamScore = {
  name?: string | null;
  score?: number | null;
};

export type ScoreCardProps = {
  href?: string;
  variant?: "landing" | "scoreboard";
  timeLabel?: string;
  locationLabel?: string;
  status?: string | null;
  footerLabel?: string;
  winner?: "home" | "away" | "even";
  home: TeamScore;
  away: TeamScore;
  className?: string;
};

function scoreboardRowTone(winner: ScoreCardProps["winner"], team: "home" | "away") {
  if (winner === "even" || !winner) return "border border-white/5 bg-white/5";
  if (winner === team) return "border border-emerald-300/30 bg-emerald-400/10";
  return "border border-red-400/30 bg-red-500/10";
}

export default function ScoreCard({
  href,
  variant = "landing",
  timeLabel,
  locationLabel,
  status,
  footerLabel,
  winner = "even",
  home,
  away,
  className = "",
}: ScoreCardProps) {
  const isLanding = variant === "landing";
  const outerClasses = isLanding
    ? "group block rounded-3xl border border-[color:var(--color-app-border)] bg-linear-to-br from-[color:var(--color-app-background-soft)] via-[color:var(--color-app-surface)] to-[color:var(--color-app-surface-soft)] p-5 text-[color:var(--color-app-foreground)] shadow-lg shadow-black/5 transition-all hover:border-[color:var(--color-app-border-strong)] hover:from-[color:rgba(var(--color-app-primary-rgb)_/_0.05)] hover:via-[color:rgba(var(--color-app-primary-rgb)_/_0.08)] hover:to-[color:rgba(var(--color-app-primary-light-rgb)_/_0.12)] hover:shadow-black/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-app-primary-soft)]"
    : "rounded-3xl border border-white/10 bg-slate-950/60 p-5 text-white shadow-lg shadow-black/30 transition hover:border-white/20 hover:bg-slate-900/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20";

  const meta = isLanding ? (
    <div className="flex flex-col gap-1 text-[0.65rem] uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)] sm:flex-row sm:items-center sm:justify-between">
      <span className="text-base font-semibold normal-case tracking-normal text-[color:var(--color-app-foreground)]">
        {timeLabel ?? "Tipoff TBA"}
      </span>
      {locationLabel ? (
        <p className="text-[0.65rem] font-medium uppercase tracking-[0.2em] text-[color:var(--color-app-foreground-muted)]">{locationLabel}</p>
      ) : null}
    </div>
  ) : (
    <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-white/40">
      <span>{timeLabel ?? "TBD"}</span>
      {status ? <span className="text-white/70">{status}</span> : null}
    </div>
  );

  const rowBase = isLanding
    ? "flex items-center justify-between rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-soft)] px-4 py-3 transition group-hover:border-[color:var(--color-app-border-strong)] group-hover:bg-[color:var(--color-app-background-soft)]"
    : "flex items-center justify-between rounded-2xl px-4 py-3 text-white";

  const rows = (
    <div className="mt-4 space-y-3 text-lg font-semibold">
      <div className={`${rowBase} ${isLanding ? "" : scoreboardRowTone(winner, "away")}`}>
        <span>{away.name ?? "Away"}</span>
        <span>{Number.isFinite(away.score ?? NaN) ? away.score : "—"}</span>
      </div>
      <div className={`${rowBase} ${isLanding ? "" : scoreboardRowTone(winner, "home")}`}>
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
