import Link from "next/link";

import { cn } from "@/lib/utils";

export type LeagueStandingsTeam = {
  id: number | string;
  name: string;
  record: string;
  standing: string;
  rank: number;
  winPct?: string;
  streak?: string | null;
  lastTen?: string | null;
  eliminatedConference?: boolean;
  href?: string;
};

export type LeagueStandingsConference = {
  id: string;
  title: string;
  subtitle?: string;
  teams: LeagueStandingsTeam[];
  emptyLabel?: string;
};

type LeagueStandingsProps = {
  conferences: LeagueStandingsConference[];
  className?: string;
};

export function LeagueStandings({ conferences, className }: LeagueStandingsProps) {
  const gridClass =
    "grid grid-cols-[18px_minmax(90px,1fr)_60px_44px_52px_62px] items-center gap-0.5 text-[10px] sm:grid-cols-[26px_minmax(200px,1fr)_82px_54px_64px_74px] sm:gap-2 sm:text-xs";

  return (
    <div className={cn("grid gap-4 lg:grid-cols-[repeat(auto-fit,minmax(360px,1fr))]", className)}>
      {conferences.map((conference) => {
        return (
          <article key={conference.id} className="rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface)] p-3 shadow-sm shadow-black/5 sm:p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[color:var(--color-app-foreground)]">{conference.title}</h3>
              {conference.subtitle ? (
                <span className="text-[0.6rem] uppercase tracking-[0.25em] text-[color:var(--color-app-foreground-muted)]">{conference.subtitle}</span>
              ) : null}
            </div>
            {conference.teams.length === 0 ? (
              <div className="mt-2 rounded-xl border border-dashed border-[color:var(--color-app-border)] px-3 py-5 text-center text-sm text-[color:var(--color-app-foreground-muted)]">
                {conference.emptyLabel ?? "Standings data isn't available yet for this season."}
              </div>
            ) : (
              <div className="mt-2 rounded-xl bg-[color:var(--color-app-background-soft)] text-[0.68rem] text-[color:var(--color-app-foreground-muted)] sm:text-xs">
                <div className="overflow-x-auto lg:overflow-visible">
                  <div className="w-full">
                    <div
                      className={cn(
                        gridClass,
                        "px-2 py-1.5 text-[0.6rem] uppercase tracking-[0.18em] text-[color:var(--color-app-foreground-muted)] sm:px-3 sm:py-2 sm:text-[0.68rem] sm:tracking-[0.2em]",
                      )}
                    >
                      <span>Rk</span>
                      <span>Team</span>
                      <span>Record</span>
                      <span>W/L%</span>
                      <span>Streak</span>
                      <span>L10</span>
                    </div>
                    <ul>
                      {conference.teams.map((team) => (
                        <li
                          key={team.id}
                          className={cn(
                            gridClass,
                            "group rounded-lg border-t border-[color:var(--color-app-border)] px-2 py-1.5 text-[0.7rem] text-[color:var(--color-app-foreground)] transition hover:bg-[color:var(--color-app-background-soft)] first:border-t-0 sm:px-3 sm:py-2 sm:text-[0.82rem]",
                          )}
                        >
                          <span className="font-semibold text-[color:var(--color-app-foreground)]">{team.standing}</span>
                          {team.href ? (
                            <Link
                              href={team.href}
                              className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.75rem] font-medium text-[color:var(--color-app-foreground)] transition hover:bg-[color:var(--color-app-background-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-app-primary-soft)] sm:px-2 sm:py-1 sm:text-[0.86rem]"
                              title={`View ${team.name}`}
                            >
                              {team.eliminatedConference ? (
                                <span className="text-[0.75rem] text-rose-400 sm:text-sm" aria-hidden="true">
                                  X
                                </span>
                              ) : null}
                              <span className="block truncate">{team.name}</span>
                            </Link>
                          ) : (
                            <p className="flex min-w-0 items-center gap-1 pr-3 text-[0.75rem] font-medium text-[color:var(--color-app-foreground)] sm:pr-5 sm:text-[0.88rem]">
                              {team.eliminatedConference ? <span className="text-rose-400">X</span> : null}
                              <span className="block truncate">{team.name}</span>
                            </p>
                          )}
                          <span className="text-[0.78rem] font-semibold text-[color:var(--color-app-foreground)] sm:text-[0.9rem]">{team.record}</span>
                          <span className="text-[0.68rem] text-[color:var(--color-app-foreground-muted)] sm:text-[0.78rem]">{team.winPct ?? "—"}</span>
                          <span className="text-[0.63rem] uppercase tracking-[0.08em] text-[color:var(--color-app-foreground-muted)] sm:text-[0.75rem] sm:tracking-[0.12em]">
                            {team.streak ?? "—"}
                          </span>
                          <span className="text-[0.63rem] uppercase tracking-[0.08em] text-[color:var(--color-app-foreground-muted)] sm:text-[0.75rem] sm:tracking-[0.12em]">
                            {team.lastTen ?? "—"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
