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
    "grid grid-cols-[20px_minmax(110px,1fr)_52px_40px_40px_48px] items-center gap-1 text-[11px] sm:grid-cols-[32px_minmax(220px,1fr)_70px_60px_60px_60px] sm:gap-4 sm:text-sm";

  return (
    <div className={cn("grid gap-4 md:grid-cols-2", className)}>
      {conferences.map((conference) => {
        return (
          <article key={conference.id} className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">{conference.title}</h3>
              {conference.subtitle ? (
                <span className="text-xs uppercase tracking-[0.3em] text-white/50">{conference.subtitle}</span>
              ) : null}
            </div>
            {conference.teams.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-white/60">
                {conference.emptyLabel ?? "Standings data isn't available yet for this season."}
              </div>
            ) : (
              <div className="mt-3 rounded-2xl bg-white/5 text-xs text-white/80 sm:text-sm">
                <div className="overflow-x-auto lg:overflow-visible">
                  <div className="inline-block min-w-[280px] sm:min-w-[520px] lg:min-w-0">
                    <div
                      className={cn(
                        gridClass,
                        "px-1 py-2 text-[8px] uppercase tracking-[0.15em] text-white/40 sm:px-3 sm:py-2 sm:text-[10px] sm:tracking-[0.25em]",
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
                            "group rounded-2xl border-t border-white/5 px-2 py-2 text-[11px] text-white/80 transition hover:bg-white/10 first:border-t-0 sm:px-4 sm:py-3 sm:text-sm",
                          )}
                        >
                          <span className="text-[11px] font-semibold text-white sm:text-sm">{team.standing}</span>
                          {team.href ? (
                            <Link
                              href={team.href}
                              className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-medium text-white/90 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 group-hover:bg-white/10 group-hover:text-white sm:gap-2 sm:text-sm"
                              title={`View ${team.name}`}
                            >
                              {team.eliminatedConference ? (
                                <span className="text-[11px] text-rose-300 sm:text-sm" aria-hidden="true">
                                  X
                                </span>
                              ) : null}
                              <span>{team.name}</span>
                            </Link>
                          ) : (
                            <p className="pr-3 text-[11px] font-medium text-white whitespace-nowrap sm:pr-6 sm:text-sm">
                              {team.eliminatedConference ? <span className="mr-1 text-rose-300">X</span> : null}
                              {team.name}
                            </p>
                          )}
                          <span className="text-[11px] font-semibold text-white sm:text-sm">{team.record}</span>
                          <span className="text-[10px] text-white/70 sm:text-xs">{team.winPct ?? "—"}</span>
                          <span className="text-[9px] uppercase tracking-[0.08em] text-white/60 sm:text-xs sm:tracking-[0.15em]">
                            {team.streak ?? "—"}
                          </span>
                          <span className="text-[9px] uppercase tracking-[0.08em] text-white/60 sm:text-xs sm:tracking-[0.15em]">
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
