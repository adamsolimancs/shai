import Link from "next/link";
import { Suspense } from "react";

import PlayerProfileSearch from "@/components/PlayerProfileSearch";
import { DEFAULT_SEASON, nbaFetch } from "@/lib/nbaApi";

type Player = {
  id: number;
  full_name: string;
  team_abbreviation: string | null;
  is_active: boolean;
};

type PlayerStatsRow = {
  player_id: number;
  player_name: string;
  team_abbreviation: string | null;
  points: number;
  rebounds: number;
  assists: number;
};

type PlayerStatMetric = "points" | "rebounds" | "assists";

type Leaderboard = {
  id: string;
  label: string;
  metric: string;
  valueKey: PlayerStatMetric;
  rows: PlayerStatsRow[];
};

type SearchParams = {
  [key: string]: string | string[] | undefined;
};

const DIRECTORY_LIMIT = 60;

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatNumber(value: number, digits = 1) {
  return value.toFixed(digits);
}

function extractParam(params: SearchParams, key: string): string {
  const raw = params[key];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0] ?? "";
  return "";
}

export default async function PlayersPage({ searchParams = {} }: { searchParams?: SearchParams }) {
  const query = extractParam(searchParams, "q").trim();
  const activeParam = extractParam(searchParams, "active");
  const active = activeParam === "true" ? true : activeParam === "false" ? false : undefined;

  const requestParams = new URLSearchParams({ season: DEFAULT_SEASON, page_size: "150", page: "1" });
  if (query) requestParams.set("search", query);
  if (active !== undefined) requestParams.set("active", String(active));

  const [directory, stats] = await Promise.all([
    nbaFetch<Player[]>(`/v1/players?${requestParams.toString()}`),
    nbaFetch<PlayerStatsRow[]>(`/v1/players/stats?season=${DEFAULT_SEASON}&page_size=60`),
  ]);

  const scoringLeaders = [...stats].sort((a, b) => b.points - a.points).slice(0, 5);
  const reboundLeaders = [...stats].sort((a, b) => b.rebounds - a.rebounds).slice(0, 5);
  const assistLeaders = [...stats].sort((a, b) => b.assists - a.assists).slice(0, 5);

  const leaderboards: Leaderboard[] = [
    { id: "points", label: "Scoring leaders", metric: "PTS", valueKey: "points", rows: scoringLeaders },
    { id: "rebounds", label: "Glass cleaners", metric: "REB", valueKey: "rebounds", rows: reboundLeaders },
    { id: "assists", label: "Assist leaders", metric: "AST", valueKey: "assists", rows: assistLeaders },
  ];

  const directorySubset = directory.slice(0, DIRECTORY_LIMIT);

  return (
    <div className="space-y-12">
      <header className="space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.5em] text-blue-300/80">Player index</p>
          <h1 className="mt-3 text-4xl font-semibold text-white">Search rosters and surface leaders</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/70">
            Use the global directory backed by the nba_data_api service to quickly jump into scouting reports, verify roster spots,
            or route into individual profile pages for deeper analytics.
          </p>
        </div>
        <Suspense
          fallback={
            <div className="h-[64px] w-full animate-pulse rounded-3xl border border-white/10 bg-white/5" aria-hidden="true" />
          }
        >
          <PlayerProfileSearch initialValue={query} />
        </Suspense>
        <form className="flex flex-wrap items-center gap-4 rounded-3xl border border-white/10 bg-slate-950/40 p-4" method="GET">
          <input type="hidden" name="q" value={query} />
          <label className="text-xs uppercase tracking-[0.3em] text-white/60" htmlFor="player-active-filter">
            Roster filter
          </label>
          <select
            id="player-active-filter"
            name="active"
            defaultValue={activeParam}
            className="rounded-2xl border border-white/10 bg-transparent px-4 py-2.5 text-sm text-white focus:border-white/40 focus:outline-none"
          >
            <option value="">All players</option>
            <option value="true">Active roster</option>
            <option value="false">Inactive / alumni</option>
          </select>
          <button
            type="submit"
            className="rounded-2xl border border-white/20 px-5 py-2 text-sm font-semibold text-white transition hover:border-white/40"
          >
            Apply
          </button>
        </form>
      </header>

      <section className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-white/40">Leaderboards</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Season pace checks</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {leaderboards.map((board) => (
            <article key={board.id} className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
              <p className="text-xs uppercase tracking-[0.4em] text-white/50">{board.label}</p>
              <ol className="mt-4 space-y-3 text-sm">
                {board.rows.map((row, index) => {
                  const slug = encodeURIComponent(slugify(row.player_name));
                  return (
                    <li key={row.player_id}>
                      <Link
                        href={`/players/${slug}`}
                        className="flex items-center justify-between rounded-2xl bg-slate-950/40 px-4 py-3 transition hover:bg-slate-950/60"
                      >
                        <div>
                          <p className="text-xs uppercase tracking-[0.3em] text-white/40">#{index + 1}</p>
                          <p className="text-base font-semibold text-white">{row.player_name}</p>
                          <p className="text-white/60">{row.team_abbreviation ?? "FA"}</p>
                        </div>
                        <span className="text-2xl font-semibold text-white">
                          {formatNumber(row[board.valueKey])}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
