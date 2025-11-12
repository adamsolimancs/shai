import Link from "next/link";

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
    { id: "assists", label: "Table setters", metric: "AST", valueKey: "assists", rows: assistLeaders },
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
        <form className="grid gap-4 rounded-3xl border border-white/10 bg-slate-950/40 p-6 md:grid-cols-[2fr_1fr_auto]" method="GET">
          <label className="sr-only" htmlFor="player-search">
            Search players
          </label>
          <input
            id="player-search"
            name="q"
            type="search"
            placeholder="Search by player name"
            defaultValue={query}
            className="rounded-2xl border border-white/10 bg-transparent px-4 py-2.5 text-sm text-white placeholder:text-white/50 focus:border-white/40 focus:outline-none"
          />
          <select
            name="active"
            defaultValue={activeParam}
            className="rounded-2xl border border-white/10 bg-transparent px-4 py-2.5 text-sm text-white focus:border-white/40 focus:outline-none"
          >
            <option value="">Roster status (all)</option>
            <option value="true">Active roster</option>
            <option value="false">Inactive / alumni</option>
          </select>
          <button
            type="submit"
            className="btn-primary rounded-2xl px-6 py-2.5 text-sm font-semibold"
          >
            Update
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
                {board.rows.map((row, index) => (
                  <li key={row.player_id} className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-white/40">#{index + 1}</p>
                      <p className="text-base font-semibold text-white">{row.player_name}</p>
                      <p className="text-white/60">{row.team_abbreviation ?? "FA"}</p>
                    </div>
                    <span className="text-2xl font-semibold text-white">
                      {formatNumber(row[board.valueKey])}
                    </span>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-white/40">Directory</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">{directorySubset.length} players displayed</h2>
            {directory.length > DIRECTORY_LIMIT && (
              <p className="text-xs text-white/60">Showing the first {DIRECTORY_LIMIT} matches for readability.</p>
            )}
          </div>
          <span className="text-xs uppercase tracking-[0.3em] text-white/60">
            Source: /v1/players?season={DEFAULT_SEASON}
          </span>
        </div>
        {directorySubset.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-10 text-center text-white/70">
            No players matched that filter. Try broadening the query or removing the roster filter.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {directorySubset.map((player) => (
              <Link
                key={player.id}
                href={`/players/${encodeURIComponent(slugify(player.full_name))}`}
                className="rounded-3xl border border-white/10 bg-slate-950/60 p-5 transition hover:border-white/30"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.4em] text-white/50">{player.team_abbreviation ?? "FA"}</p>
                    <h3 className="mt-1 text-xl font-semibold text-white">{player.full_name}</h3>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      player.is_active ? "border border-emerald-400/30 text-emerald-200" : "border border-white/20 text-white/60"
                    }`}
                  >
                    {player.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
