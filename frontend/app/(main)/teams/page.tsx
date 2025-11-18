import Link from "next/link";

import { LeagueStandings, type LeagueStandingsConference } from "@/components/LeagueStandings";
import { DEFAULT_SEASON, nbaFetch } from "@/lib/nbaApi";
import { slugifySegment } from "@/lib/utils";

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
  steals?: number | null;
  blocks?: number | null;
  turnovers?: number | null;
  plus_minus?: number | null;
};

type LeagueStanding = {
  team_id: number;
  team_name: string;
  team_city: string;
  conference?: string | null;
  conference_rank?: number | null;
  division?: string | null;
  division_rank?: number | null;
  wins: number;
  losses: number;
  win_pct: number;
  streak?: string | null;
  last_ten?: string | null;
  eliminated_conference?: boolean | number | null;
};

type MetaResponse = {
  service: string;
  version: string;
  supported_seasons: string[];
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

function formatWinRatio(value: number | undefined, digits = 3): string {
  if (value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return value.toFixed(digits);
}

function formatStandingRecord(standing: LeagueStanding): string {
  return `${standing.wins}-${standing.losses}`;
}

function formatStandingTeamName(standing: LeagueStanding, team?: Team): string {
  if (team) {
    return formatTeamName(team);
  }
  const full = `${standing.team_city ?? ""} ${standing.team_name ?? ""}`.trim();
  return full || standing.team_name || "—";
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

async function fetchLeagueStandingsData(season: string): Promise<LeagueStanding[]> {
  try {
    return await nbaFetch<LeagueStanding[]>(
      `/v1/league_standings?season=${season}&league_id=00&season_type=Regular%20Season`,
      { next: { revalidate: 900 } },
    );
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}

export default async function TeamsPage({ searchParams = {} }: { searchParams?: SearchParams }) {
  const requestedSeason = extractParam(searchParams, "season");
  const preferredSeason = isValidSeason(requestedSeason) ? requestedSeason : DEFAULT_SEASON;

  const meta = await nbaFetch<MetaResponse>("/v1/meta", { next: { revalidate: 3600 } });
  const advertisedSeasons = meta.supported_seasons ?? [];
  const fallbackSeason = advertisedSeasons.at(-1) ?? preferredSeason;
  const activeSeason = advertisedSeasons.includes(preferredSeason) ? preferredSeason : fallbackSeason;
  const usingFallbackSeason = activeSeason !== preferredSeason;

  const teams = await nbaFetch<Team[]>(`/v1/teams?season=${activeSeason}`, { next: { revalidate: 1800 } });

  const currentTeams = teams.filter(isCurrentFranchise).sort(compareByCurrentOrder);
  const teamMap = new Map<number, Team>(currentTeams.map((team) => [team.id, team]));

  const [teamStats, leagueStandings] = await Promise.all([
    fetchTeamStats(
      activeSeason,
      currentTeams.map((team) => team.id),
    ),
    fetchLeagueStandingsData(activeSeason),
  ]);

  const sortedTeams = [...currentTeams].sort((a, b) => formatTeamName(a).localeCompare(formatTeamName(b)));

  const statsByTeamId = new Map<number, TeamStatsRow>();
  teamStats.forEach((row) => {
    if (teamMap.has(row.team_id)) {
      statsByTeamId.set(row.team_id, row);
    }
  });
  const filteredStats = [...statsByTeamId.values()];

  const buildConferenceRows = (key: string) =>
    leagueStandings
      .filter((row) => (row.conference ?? "").toLowerCase() === key)
      .sort((a, b) => (a.conference_rank ?? 99) - (b.conference_rank ?? 99))
      .map((standing, index) => ({
        rank: standing.conference_rank ?? index + 1,
        standing,
        team: teamMap.get(standing.team_id),
      }));

  const conferenceStandings: LeagueStandingsConference[] = [
    {
      id: "east",
      title: "Eastern Conference",
      rows: buildConferenceRows("east"),
    },
    {
      id: "west",
      title: "Western Conference",
      rows: buildConferenceRows("west"),
    },
  ].map((group) => {
    const subtitle = group.rows.length === 0 ? "Awaiting data" : undefined;
    return {
      id: group.id,
      title: group.title,
      subtitle,
      teams: group.rows.map(({ rank, standing, team }) => {
        const name = formatStandingTeamName(standing, team);
        const slug = slugifySegment(name);
        return {
          id: standing.team_id,
          name,
          record: formatStandingRecord(standing),
          standing: String(rank),
          rank,
          winPct: formatWinRatio(standing.win_pct),
          streak: standing.streak ?? null,
          lastTen: standing.last_ten ?? null,
          eliminatedConference: Boolean(standing.eliminated_conference),
          href: slug ? `/teams/${slug}` : undefined,
        };
      }),
      emptyLabel: "Standings data isn't available yet for this season.",
    };
  });

  const assistToTurnover = (row: TeamStatsRow) => {
    const turnovers = row.turnovers ?? 0;
    if (!turnovers) {
      return row.assists;
    }
    return row.assists / turnovers;
  };

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
    {
      id: "defense",
      label: "Defensive pressure",
      metric: "STL",
      accessor: (row: TeamStatsRow) => row.steals ?? 0,
      formatter: (value: number) => value.toFixed(1),
    },
    {
      id: "rimProtection",
      label: "Rim protection",
      metric: "BLK",
      accessor: (row: TeamStatsRow) => row.blocks ?? 0,
      formatter: (value: number) => value.toFixed(1),
    },
    {
      id: "netImpact",
      label: "Net impact",
      metric: "+/-",
      accessor: (row: TeamStatsRow) => row.plus_minus ?? 0,
      formatter: (value: number) => value.toFixed(1),
    },
    {
      id: "assistToTurnover",
      label: "Assist-to-turnover",
      metric: "AST/TOV",
      accessor: assistToTurnover,
      formatter: (value: number) => value.toFixed(2),
    },
  ] as const;

  const leaderboards = leaderboardConfigs.map((config) => ({
    ...config,
    rows: [...filteredStats]
      .sort((a, b) => config.accessor(b) - config.accessor(a))
      .slice(0, 3),
  }));

  const historicSeasons = [...advertisedSeasons]
    .filter((option) => option !== activeSeason)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 8);

  return (
    <div className="space-y-12">
      <section className="space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-white/40">Season dashboard</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{activeSeason} Standings</h2>
          {usingFallbackSeason && (
            <p className="mt-2 text-xs text-amber-200/80">
              Requested season {preferredSeason} isn&apos;t available yet. Showing {activeSeason} data instead.
            </p>
          )}
        </div>
        <LeagueStandings conferences={conferenceStandings} className="lg:grid-cols-2" />
      </section>

      <section className="space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-white/40">Season pulse</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Key statistical leaders</h2>
          <p className="mt-1 text-sm text-white/60">Top-3 teams by scoring, glass work, ball movement, and shooting.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-white/40">Team directory</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">{sortedTeams.length} quick-reference cards</h2>
          </div>
          <span className="text-xs uppercase tracking-[0.3em] text-white/60">Updated for {activeSeason}</span>
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
