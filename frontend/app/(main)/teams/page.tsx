import Link from "next/link";

import { DEFAULT_SEASON, nbaFetch } from "@/lib/nbaApi";

type Team = {
  id: number;
  city: string;
  name: string;
  abbreviation: string;
  conference: string | null;
  division: string | null;
};

type TeamStatsRow = {
  team_id: number;
  team_abbreviation: string;
  team_name: string;
  games_played: number;
  wins: number;
  losses: number;
  win_pct: number;
  points: number;
  field_goal_pct: number;
  rebounds: number;
  assists: number;
};

type MetaResponse = {
  service: string;
  version: string;
  supported_seasons: string[];
};

type Grouped<T> = {
  key: string;
  items: T[];
};

type SearchParams = {
  [key: string]: string | string[] | undefined;
};

type Franchise = {
  name: string;
  abbreviation: string;
  aliases?: string[];
};

const CURRENT_FRANCHISES: Franchise[] = [
  { name: "Atlanta Hawks", abbreviation: "ATL" },
  { name: "Boston Celtics", abbreviation: "BOS" },
  { name: "Brooklyn Nets", abbreviation: "BKN" },
  { name: "Charlotte Hornets", abbreviation: "CHA" },
  { name: "Chicago Bulls", abbreviation: "CHI" },
  { name: "Cleveland Cavaliers", abbreviation: "CLE" },
  { name: "Dallas Mavericks", abbreviation: "DAL" },
  { name: "Denver Nuggets", abbreviation: "DEN" },
  { name: "Detroit Pistons", abbreviation: "DET" },
  { name: "Golden State Warriors", abbreviation: "GSW" },
  { name: "Houston Rockets", abbreviation: "HOU" },
  { name: "Indiana Pacers", abbreviation: "IND" },
  { name: "Los Angeles Clippers", abbreviation: "LAC", aliases: ["LA Clippers"] },
  { name: "Los Angeles Lakers", abbreviation: "LAL", aliases: ["LA Lakers"] },
  { name: "Memphis Grizzlies", abbreviation: "MEM" },
  { name: "Miami Heat", abbreviation: "MIA" },
  { name: "Milwaukee Bucks", abbreviation: "MIL" },
  { name: "Minnesota Timberwolves", abbreviation: "MIN" },
  { name: "New Orleans Pelicans", abbreviation: "NOP" },
  { name: "New York Knicks", abbreviation: "NYK" },
  { name: "Oklahoma City Thunder", abbreviation: "OKC" },
  { name: "Orlando Magic", abbreviation: "ORL" },
  { name: "Philadelphia 76ers", abbreviation: "PHI" },
  { name: "Phoenix Suns", abbreviation: "PHX" },
  { name: "Portland Trail Blazers", abbreviation: "POR" },
  { name: "Sacramento Kings", abbreviation: "SAC" },
  { name: "San Antonio Spurs", abbreviation: "SAS" },
  { name: "Toronto Raptors", abbreviation: "TOR" },
  { name: "Utah Jazz", abbreviation: "UTA" },
  { name: "Washington Wizards", abbreviation: "WAS" },
];

const CURRENT_TEAM_NAME_INDEX = new Map<string, number>();
const CURRENT_TEAM_ABBR_INDEX = new Map<string, number>();
CURRENT_FRANCHISES.forEach((team, index) => {
  CURRENT_TEAM_NAME_INDEX.set(team.name.toLowerCase(), index);
  team.aliases?.forEach((alias) => CURRENT_TEAM_NAME_INDEX.set(alias.toLowerCase(), index));
  CURRENT_TEAM_ABBR_INDEX.set(team.abbreviation.toUpperCase(), index);
});

function formatTeamName(team: Team) {
  const fullName = `${team.city} ${team.name}`.trim();
  return fullName || team.abbreviation;
}

function groupByConference(teams: Team[]): Grouped<Team>[] {
  const map = new Map<string, Team[]>();
  teams.forEach((team) => {
    const key = team.conference ?? "Independent";
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(team);
  });
  return [...map.entries()]
    .map(([key, items]) => ({ key, items: items.sort((a, b) => formatTeamName(a).localeCompare(formatTeamName(b))) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function groupByDivision(teams: Team[]): Grouped<Team>[] {
  const map = new Map<string, Team[]>();
  teams.forEach((team) => {
    const division = team.division ?? "No Division";
    if (!map.has(division)) {
      map.set(division, []);
    }
    map.get(division)!.push(team);
  });
  return [...map.entries()]
    .map(([key, items]) => ({ key, items: items.sort((a, b) => formatTeamName(a).localeCompare(formatTeamName(b))) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function extractParam(params: SearchParams, key: string): string {
  const raw = params[key];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0] ?? "";
  return "";
}

function isValidSeason(value: string | undefined): value is string {
  if (!value) return false;
  return /^\d{4}-\d{2}$/.test(value);
}

function formatRecord(stats?: TeamStatsRow): string {
  if (!stats) {
    return "—";
  }
  return `${stats.wins}-${stats.losses}`;
}

function formatNumber(value: number | undefined, digits = 1): string {
  if (value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return value.toFixed(digits);
}

function formatPercent(value: number | undefined, digits = 1): string {
  if (value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${(value * 100).toFixed(digits)}%`;
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && (/404/.test(error.message) || /Not Found/i.test(error.message));
}

function lookupFranchiseByName(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  return CURRENT_TEAM_NAME_INDEX.get(value.toLowerCase());
}

function getFranchiseOrder(team: Team): number | undefined {
  return (
    lookupFranchiseByName(formatTeamName(team)) ??
    lookupFranchiseByName(team.name) ??
    lookupFranchiseByName([team.city, team.name].filter(Boolean).join(" ")) ??
    (team.abbreviation ? CURRENT_TEAM_ABBR_INDEX.get(team.abbreviation.toUpperCase()) : undefined)
  );
}

function isCurrentFranchise(team: Team): boolean {
  return getFranchiseOrder(team) !== undefined;
}

function compareByCurrentOrder(a: Team, b: Team): number {
  const aIndex = getFranchiseOrder(a) ?? Number.MAX_SAFE_INTEGER;
  const bIndex = getFranchiseOrder(b) ?? Number.MAX_SAFE_INTEGER;
  if (aIndex === bIndex) {
    return formatTeamName(a).localeCompare(formatTeamName(b));
  }
  return aIndex - bIndex;
}

async function fetchTeamStats(season: string, teamIds: number[]): Promise<TeamStatsRow[]> {
  let stats: TeamStatsRow[] = [];
  try {
    stats = await nbaFetch<TeamStatsRow[]>(
      `/v1/teams/stats?season=${season}&measure=Base&per_mode=PerGame`,
      { next: { revalidate: 600 } },
    );
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  if (stats.length > 0 || teamIds.length === 0) {
    return stats;
  }

  const uniqueTeamIds = [...new Set(teamIds)];
  const perTeam = await Promise.all(
    uniqueTeamIds.map(async (teamId) => {
      try {
        const rows = await nbaFetch<TeamStatsRow[]>(
          `/v1/teams/${teamId}/stats?season=${season}&measure=Base&per_mode=PerGame`,
          { next: { revalidate: 600 } },
        );
        return rows[0];
      } catch {
        return undefined;
      }
    }),
  );

  return perTeam.filter((row): row is TeamStatsRow => Boolean(row));
}

export default async function TeamsPage({ searchParams = {} }: { searchParams?: SearchParams }) {
  const requestedSeason = extractParam(searchParams, "season");
  const season = isValidSeason(requestedSeason) ? requestedSeason : DEFAULT_SEASON;

  const [teams, meta] = await Promise.all([
    nbaFetch<Team[]>(`/v1/teams?season=${season}`, { next: { revalidate: 1800 } }),
    nbaFetch<MetaResponse>("/v1/meta", { next: { revalidate: 3600 } }),
  ]);

  const currentTeams = teams.filter(isCurrentFranchise).sort(compareByCurrentOrder);
  const teamMap = new Map<number, Team>(currentTeams.map((team) => [team.id, team]));

  const teamStats = await fetchTeamStats(
    season,
    currentTeams.map((team) => team.id),
  );

  const sortedTeams = [...currentTeams].sort((a, b) => formatTeamName(a).localeCompare(formatTeamName(b)));
  const conferences = groupByConference(currentTeams);
  const divisions = groupByDivision(currentTeams);

  const statsByTeamId = new Map<number, TeamStatsRow>();
  teamStats.forEach((row) => {
    if (teamMap.has(row.team_id)) {
      statsByTeamId.set(row.team_id, row);
    }
  });
  const filteredStats = [...statsByTeamId.values()];

  const standings = [...filteredStats]
    .sort((a, b) => {
      if (b.win_pct !== a.win_pct) return b.win_pct - a.win_pct;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.losses - b.losses;
    })
    .map((row, index) => ({
      rank: index + 1,
      stats: row,
      team: teamMap.get(row.team_id),
    }));
  const topStandings = standings.slice(0, 10);

  const leaderboardConfigs = [
    {
      id: "points",
      label: "Scoring pace",
      metric: "PTS",
      accessor: (row: TeamStatsRow) => row.points,
      formatter: (value: number) => value.toFixed(1),
    },
    {
      id: "rebounds",
      label: "Glass work",
      metric: "REB",
      accessor: (row: TeamStatsRow) => row.rebounds,
      formatter: (value: number) => value.toFixed(1),
    },
    {
      id: "assists",
      label: "Ball movement",
      metric: "AST",
      accessor: (row: TeamStatsRow) => row.assists,
      formatter: (value: number) => value.toFixed(1),
    },
    {
      id: "efficiency",
      label: "Shooting efficiency",
      metric: "FG%",
      accessor: (row: TeamStatsRow) => row.field_goal_pct,
      formatter: (value: number) => `${(value * 100).toFixed(1)}%`,
    },
  ] as const;

  const leaderboards = leaderboardConfigs.map((config) => ({
    ...config,
    rows: [...filteredStats]
      .sort((a, b) => config.accessor(b) - config.accessor(a))
      .slice(0, 3),
  }));

  const historicSeasons = [...(meta.supported_seasons ?? [])]
    .filter((option) => option !== season)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 8);

  return (
    <div className="space-y-12">
      <section className="space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-white/40">Season dashboard</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Standings and pace-setters</h2>
          <p className="mt-1 text-sm text-white/60">Wins, losses, and stat leaders for the {season} campaign.</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
          <article className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">League standings</h3>
              <span className="text-xs uppercase tracking-[0.3em] text-white/50">Top 10</span>
            </div>
            <div className="mt-4 space-y-2 text-sm text-white/80">
              {topStandings.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-white/60">
                  Standings data isn&apos;t available yet for this season.
                </div>
              ) : (
                topStandings.map(({ rank, stats, team }) => (
                  <div
                    key={stats.team_id}
                    className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3"
                  >
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-white/40">#{rank}</p>
                      <p className="text-base font-semibold text-white">{team?.name ? formatTeamName(team) : stats.team_name}</p>
                      <p className="text-white/60">
                        {formatRecord(stats)} • {team?.conference ?? "—"}
                      </p>
                    </div>
                    <span className="text-2xl font-semibold text-white">{formatPercent(stats.win_pct, 1)}</span>
                  </div>
                ))
              )}
            </div>
          </article>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {leaderboards.map((board) => (
              <article key={board.id} className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
                <p className="text-xs uppercase tracking-[0.4em] text-white/50">{board.label}</p>
                <ol className="mt-4 space-y-3 text-sm">
                  {board.rows.length === 0 ? (
                    <li className="rounded-2xl border border-dashed border-white/10 px-4 py-3 text-center text-xs text-white/60">
                      Metric offline for now.
                    </li>
                  ) : (
                    board.rows.map((row, index) => (
                      <li key={row.team_id} className="flex items-center justify-between">
                        <div>
                          <p className="text-xs uppercase tracking-[0.3em] text-white/40">#{index + 1}</p>
                          <p className="text-base font-semibold text-white">{row.team_name}</p>
                          <p className="text-white/60">{row.team_abbreviation}</p>
                        </div>
                        <span className="text-2xl font-semibold text-white">
                          {board.formatter(board.accessor(row))}
                        </span>
                      </li>
                    ))
                  )}
                </ol>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-white/40">Conference picture</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">How {season} lines up</h2>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {conferences.map((conference) => (
            <article key={conference.key} className="rounded-3xl border border-white/10 bg-slate-950/60 p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold text-white">{conference.key} Conference</h3>
                <span className="text-xs uppercase text-white/60">{conference.items.length} teams</span>
              </div>
              <ul className="mt-4 space-y-2 text-sm text-white/80">
                {conference.items.map((team) => (
                  <li key={team.id} className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                    <span className="font-medium text-white">{formatTeamName(team)}</span>
                    <span className="text-white/60">{team.division ?? "—"}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-white/40">Divisional pods</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Six-way breakdown</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {divisions.map((division) => (
            <article key={division.key} className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">{division.key}</h3>
                <span className="text-xs uppercase text-white/60">{division.items[0]?.conference ?? "—"}</span>
              </div>
              <ul className="mt-4 space-y-2 text-sm text-white/80">
                {division.items.map((team) => (
                  <li key={team.id} className="flex items-center justify-between">
                    <span>{team.abbreviation}</span>
                    <span className="text-white/60">{formatTeamName(team)}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-white/40">Team directory</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">{sortedTeams.length} quick-reference cards</h2>
          </div>
          <span className="text-xs uppercase tracking-[0.3em] text-white/60">Updated for {season}</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sortedTeams.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/40 p-10 text-center text-white/60">
              No active franchises were returned for this season.
            </div>
          ) : (
            sortedTeams.map((team) => {
              const stats = statsByTeamId.get(team.id);
              return (
                <article key={team.id} className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.4em] text-white/50">{team.abbreviation}</p>
                      <h3 className="mt-1 text-xl font-semibold text-white">{formatTeamName(team)}</h3>
                      <p className="text-xs text-white/60">{team.conference ?? "—"} · {team.division ?? "—"}</p>
                    </div>
                    <div className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/70">
                      {formatRecord(stats)}
                    </div>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs uppercase tracking-[0.2em] text-white/50">
                    <div>
                      <dt>PTS</dt>
                      <dd className="mt-1 text-sm font-medium text-white">{formatNumber(stats?.points)}</dd>
                    </div>
                    <div>
                      <dt>REB</dt>
                      <dd className="mt-1 text-sm font-medium text-white">{formatNumber(stats?.rebounds)}</dd>
                    </div>
                    <div>
                      <dt>AST</dt>
                      <dd className="mt-1 text-sm font-medium text-white">{formatNumber(stats?.assists)}</dd>
                    </div>
                    <div>
                      <dt>FG%</dt>
                      <dd className="mt-1 text-sm font-medium text-white">{formatPercent(stats?.field_goal_pct)}</dd>
                    </div>
                  </dl>
                </article>
              );
            })
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-white/40">Historic data</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Archive jumps</h2>
          <p className="mt-1 text-sm text-white/60">
            Need to study a previous season? Use these quick links to reload this page with archived data.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {historicSeasons.length === 0 ? (
            <span className="text-sm text-white/60">Historic seasons will appear when the API advertises them.</span>
          ) : (
            historicSeasons.map((seasonOption) => (
              <Link
                key={seasonOption}
                href={`/teams?season=${seasonOption}`}
                className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-white/80 transition hover:border-white/40"
              >
                {seasonOption}
              </Link>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
