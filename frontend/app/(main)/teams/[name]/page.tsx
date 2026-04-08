import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

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

type LeagueStanding = {
  team_id: number;
  conference?: string | null;
  conference_rank?: number | null;
  division?: string | null;
  division_rank?: number | null;
  wins?: number | null;
  losses?: number | null;
  win_pct?: number | null;
  games_back?: number | null;
  division_games_back?: number | null;
  record?: string | null;
  home_record?: string | null;
  road_record?: string | null;
  last_ten?: string | null;
  streak?: string | null;
};

type TeamDetail = {
  team_id: number;
  abbreviation?: string | null;
  nickname?: string | null;
  city?: string | null;
  year_founded?: number | null;
  arena?: string | null;
  arena_capacity?: number | null;
  owner?: string | null;
  general_manager?: string | null;
  head_coach?: string | null;
  dleague_affiliation?: string | null;
  championships: string[];
  conference_titles: string[];
  division_titles: string[];
  hall_of_famers: string[];
  retired_numbers: string[];
  social_sites: Record<string, string>;
};

type TeamSeasonHistoryRow = {
  team_id: number;
  team_city?: string | null;
  team_name?: string | null;
  season: string;
  games_played: number;
  wins: number;
  losses: number;
  win_pct: number;
  conference_rank?: number | null;
  division_rank?: number | null;
  playoff_wins?: number | null;
  playoff_losses?: number | null;
  finals_result?: string | null;
  points?: number | null;
  field_goal_pct?: number | null;
  three_point_pct?: number | null;
};

type TeamContext = {
  team: Team;
  standing: LeagueStanding | null;
  details: TeamDetail | null;
  history: TeamSeasonHistoryRow[];
  season: string;
};

type Fact = {
  label: string;
  value: ReactNode;
};

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

const formatListPreview = (items: string[], limit = 4): ReactNode | null => {
  const cleaned = items.map((item) => item?.trim()).filter(Boolean) as string[];
  if (!cleaned.length) return null;
  if (cleaned.length <= limit) return cleaned.join(", ");
  const preview = cleaned.slice(0, limit).join(", ");
  const fullList = cleaned.join(", ");
  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-2">
      <span>{preview}</span>
      <details className="group inline-block">
        <summary className="cursor-pointer list-none text-[0.6rem] uppercase tracking-[0.25em] text-white/50 transition hover:text-white">
          View all
        </summary>
        <div className="mt-2 text-sm text-white/70">{fullList}</div>
      </details>
    </span>
  );
};

const formatRecord = (standing: LeagueStanding | null): string | null => {
  if (!standing) return null;
  if (standing.record?.trim()) return standing.record.trim();
  const wins = standing.wins;
  const losses = standing.losses;
  if (typeof wins === "number" && typeof losses === "number") {
    return `${wins}-${losses}`;
  }
  return null;
};

const formatWinPct = (value?: number | null): string | null => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return value.toFixed(3);
};

const formatGamesBack = (value?: number | null): string | null => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return value.toFixed(1);
};

const formatRank = (value?: number | null): string | null => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return `#${value}`;
};

const formatConference = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^east$/i.test(trimmed)) return "Eastern Conference";
  if (/^west$/i.test(trimmed)) return "Western Conference";
  return trimmed;
};

const formatDivision = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const formatHistoryWinPct = (value?: number | null): string | null => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return value.toFixed(3);
};

const formatPlayoffSummary = (row: TeamSeasonHistoryRow): string | null => {
  const finals = row.finals_result?.trim();
  if (finals && finals.toLowerCase() !== "n/a") {
    return finals;
  }
  const wins = row.playoff_wins;
  const losses = row.playoff_losses;
  if (
    typeof wins === "number" &&
    typeof losses === "number" &&
    (wins > 0 || losses > 0)
  ) {
    return `Playoffs ${wins}-${losses}`;
  }
  return null;
};

const formatSocialLabel = (value: string): string => {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
};

const buildFacts = (items: Array<{ label: string; value: ReactNode | null }>): Fact[] =>
  items.filter((item): item is Fact => Boolean(item.value));

const getTeamFullName = (team: Team): string => {
  const full = [team.city, team.name].filter(Boolean).join(" ").trim();
  return full || team.name || team.abbreviation || "Team";
};

const resolveTeamBySlug = (teams: Team[], slug: string): Team | null => {
  const normalized = slugifySegment(slug);
  if (!normalized) return null;

  const byFullName = teams.find((team) => slugifySegment(getTeamFullName(team)) === normalized);
  if (byFullName) return byFullName;

  const byName = teams.find((team) => slugifySegment(team.name) === normalized);
  if (byName) return byName;

  const byAbbr = teams.find(
    (team) => team.abbreviation && slugifySegment(team.abbreviation) === normalized,
  );
  return byAbbr ?? null;
};

const isNotFoundError = (error: unknown): boolean =>
  error instanceof Error && (/404/.test(error.message) || /Not Found/i.test(error.message));

async function fetchTeams(): Promise<Team[]> {
  return nbaFetch<Team[]>(`/v1/teams?season=${DEFAULT_SEASON}`, { next: { revalidate: 1800 } });
}

async function fetchLeagueStandings(): Promise<LeagueStanding[]> {
  return nbaFetch<LeagueStanding[]>(
    `/v1/league_standings?season=${DEFAULT_SEASON}&league_id=00&season_type=Regular%20Season`,
    { next: { revalidate: 900 } },
  );
}

async function fetchTeamDetails(teamId: number): Promise<TeamDetail | null> {
  try {
    return await nbaFetch<TeamDetail>(`/v1/teams/${teamId}/details`, { next: { revalidate: 3600 } });
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function fetchTeamHistory(teamId: number): Promise<TeamSeasonHistoryRow[]> {
  try {
    return await nbaFetch<TeamSeasonHistoryRow[]>(
      `/v1/teams/${teamId}/history?season_type=Regular%20Season&per_mode=Totals&limit=8`,
      { next: { revalidate: 3600 } },
    );
  } catch {
    return [];
  }
}

async function fetchTeamContext(slug: string): Promise<TeamContext | null> {
  const decodedSlug = decodeURIComponent(slug);
  const teams = await fetchTeams();
  const team = resolveTeamBySlug(teams, decodedSlug);
  if (!team) return null;

  const [standings, details, history] = await Promise.all([
    fetchLeagueStandings(),
    fetchTeamDetails(team.id),
    fetchTeamHistory(team.id),
  ]);
  const standing = standings.find((row) => row.team_id === team.id) ?? null;

  return {
    team,
    standing,
    details,
    history,
    season: DEFAULT_SEASON,
  };
}

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ name?: string | string[] }> | { name?: string | string[] };
}) {
  const resolvedParams = await Promise.resolve(params);
  const slug = Array.isArray(resolvedParams.name) ? resolvedParams.name[0] : resolvedParams.name;
  if (!slug) {
    notFound();
  }

  const context = await fetchTeamContext(slug);

  if (!context) {
    notFound();
  }

  const { team, standing, details, season } = context;
  const teamName = getTeamFullName(team);
  const record = formatRecord(standing);
  const winPct = formatWinPct(standing?.win_pct);
  const recordWithWinPct = record && winPct ? `${record} (${winPct})` : record;
  const conferenceLabel = formatConference(standing?.conference ?? team.conference);
  const divisionLabel = formatDivision(standing?.division ?? team.division);
  const headerKicker = [conferenceLabel, divisionLabel].filter(Boolean).join(" · ");
  const summaryLine = [team.abbreviation].filter(Boolean).join(" · ");

  const overviewFacts = buildFacts([
    { label: "Head coach", value: details?.head_coach ?? null },
    { label: "Arena", value: details?.arena ?? null },
    {
      label: "Capacity",
      value:
        typeof details?.arena_capacity === "number"
          ? NUMBER_FORMAT.format(details.arena_capacity)
          : null,
    },
  ]);

  const competitiveFacts = buildFacts([
    { label: "Record", value: recordWithWinPct },
    { label: "Conference rank", value: formatRank(standing?.conference_rank) },
    { label: "Division rank", value: formatRank(standing?.division_rank) },
    { label: "Games back", value: formatGamesBack(standing?.games_back) },
    { label: "Division games back", value: formatGamesBack(standing?.division_games_back) },
    { label: "Home record", value: standing?.home_record ?? null },
    { label: "Road record", value: standing?.road_record ?? null },
    { label: "Last 10", value: standing?.last_ten ?? null },
    { label: "Streak", value: standing?.streak ?? null },
  ]);

  const historyFacts = buildFacts([
    { label: "Year founded", value: details?.year_founded ? String(details.year_founded) : null },
    { label: "Owner", value: details?.owner ?? null },
    { label: "General manager", value: details?.general_manager ?? null },
    { label: "G League affiliate", value: details?.dleague_affiliation ?? null },
  ]);

  const legacyFacts = buildFacts([
    { label: "Championships", value: formatListPreview(details?.championships ?? []) },
    { label: "Conference titles", value: formatListPreview(details?.conference_titles ?? []) },
    { label: "Division titles", value: formatListPreview(details?.division_titles ?? []) },
    { label: "Hall of famers", value: formatListPreview(details?.hall_of_famers ?? []) },
    { label: "Retired numbers", value: formatListPreview(details?.retired_numbers ?? []) },
  ]);

  const socialEntries = details?.social_sites
    ? Object.entries(details.social_sites).filter(([, url]) => typeof url === "string" && url.trim())
    : [];
  const recentHistory = context.history
    .filter((row) => row.season)
    .sort((a, b) => b.season.localeCompare(a.season))
    .slice(0, 6);

  const showCompetitive = competitiveFacts.length > 0;
  const showRecentHistory = recentHistory.length > 0;
  const showHistory = historyFacts.length > 0 || legacyFacts.length > 0 || socialEntries.length > 0;

  return (
    <div className="space-y-8">
      <Link
        href="/teams"
        className="inline-flex items-center gap-2 text-sm text-white/70 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        <span aria-hidden="true">←</span>
        Back to teams
      </Link>

      <section className="text-center">
        <p className="my-0 text-s uppercase tracking-[0.35em] text-white/40">Team overview</p>
        <h1 className="text-5xl font-semibold text-white">{teamName + ` (${summaryLine})`}</h1>
        {headerKicker ? (
          <p className="mt-4 text-xs uppercase tracking-[0.3em] text-white/50">{headerKicker + " division"}</p>
        ) : null}
        {overviewFacts.length > 0 ? (
          <dl className="mt-4 flex flex-wrap justify-center gap-x-10 gap-y-3 text-sm text-white/70">
            {overviewFacts.map((fact) => (
              <div key={fact.label} className="min-w-[9rem] text-center">
                <dt className="text-xs uppercase tracking-[0.3em] text-white/40">{fact.label}</dt>
                <dd className="mt-1 text-base text-white">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>

      {showCompetitive ? (
        <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold text-white">Season Snapshot</h2>
            </div>
            <span className="text-xs uppercase tracking-[0.3em] text-white/60">{season} season</span>
          </div>
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm text-white/70 sm:grid-cols-2 lg:grid-cols-3">
            {competitiveFacts.map((fact) => (
              <div key={fact.label} className="flex items-center justify-between gap-3">
                <dt className="text-xs uppercase tracking-[0.3em] text-white/40">{fact.label}</dt>
                <dd className="text-base text-white">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {showRecentHistory ? (
        <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold text-white">Recent Seasons</h2>
            </div>
            <span className="text-xs uppercase tracking-[0.3em] text-white/60">
              Last {recentHistory.length}
            </span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {recentHistory.map((row) => {
              const playoffSummary = formatPlayoffSummary(row);
              const winPct = formatHistoryWinPct(row.win_pct);
              return (
                <article
                  key={row.season}
                  className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm uppercase tracking-[0.35em] text-white/50">{row.season}</p>
                    <p className="text-lg font-semibold text-white">
                      {row.wins}-{row.losses}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-white/70">
                    {winPct ? <span>Win% {winPct}</span> : null}
                    {row.conference_rank ? <span>Conf #{row.conference_rank}</span> : null}
                    {row.division_rank ? <span>Div #{row.division_rank}</span> : null}
                    {playoffSummary ? <span>{playoffSummary}</span> : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {showHistory ? (
        <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-5 text-center">
          <div>
            <h2 className="text-2xl font-semibold text-white">Franchise History</h2>
          </div>
          {historyFacts.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs uppercase tracking-[0.3em] text-white/50">Front office</p>
              <dl className="mt-3 flex flex-wrap justify-center gap-x-10 gap-y-3 text-sm text-white/70">
                {historyFacts.map((fact) => (
                  <div key={fact.label} className="min-w-[10rem] text-center">
                    <dt className="text-xs uppercase tracking-[0.3em] text-white/40">{fact.label}</dt>
                    <dd className="mt-1 text-base text-white">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          {legacyFacts.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs uppercase tracking-[0.3em] text-white/50">Honors</p>
              <dl className="mt-3 flex flex-wrap justify-center gap-x-10 gap-y-3 text-sm text-white/70">
                {legacyFacts.map((fact) => (
                  <div key={fact.label} className="min-w-[12rem] text-center">
                    <dt className="text-xs uppercase tracking-[0.3em] text-white/40">{fact.label}</dt>
                    <dd className="mt-1 text-base text-white">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          {socialEntries.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs uppercase tracking-[0.3em] text-white/50">Social</p>
              <div className="mt-3 flex flex-wrap justify-center gap-3 text-sm">
                {socialEntries.map(([platform, url]) => (
                  <a
                    key={platform}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-1 text-white/80 transition hover:border-white/40 hover:text-white"
                  >
                    <span className="text-xs uppercase tracking-[0.3em]">
                      {formatSocialLabel(platform)}
                    </span>
                    <span aria-hidden="true">↗</span>
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
