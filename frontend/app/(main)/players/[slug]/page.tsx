import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { DEFAULT_SEASON, nbaFetch } from "@/lib/nbaApi";

type ResolutionPayload = {
  id: number;
  name: string;
  abbreviation?: string | null;
  confidence: number;
};

type ResolveResult = {
  player?: ResolutionPayload | null;
  team?: ResolutionPayload | null;
};

type PlayerCareerStatsRow = {
  season_id: string;
  team_id: number | null;
  team_abbreviation: string | null;
  player_age: number | null;
  games_played: number;
  games_started: number;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number | null;
  blocks: number | null;
  field_goal_pct: number | null;
  three_point_pct: number | null;
  free_throw_pct: number | null;
};

type PlayerGameLog = {
  game_id: string;
  game_date: string;
  matchup: string;
  team_abbreviation: string;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  plus_minus: number | null;
};

type TeamStatsRow = {
  team_id: number;
  team_name: string;
  team_abbreviation: string;
  wins: number;
  losses: number;
  win_pct: number;
};

type Player = {
  id: number;
  full_name: string;
};

type PlayerProfile = {
  slug: string;
  playerId: number;
  name: string;
  team: string;
  teamAbbreviation: string | null;
  headshot: string;
  rating: number;
  scoutingReport: string;
  age?: number | null;
  experience: string;
  currentSeason?: {
    seasonId: string;
    teamRecord?: string;
    stats: SeasonStats;
    insights: { label: string; value: string }[];
  };
  careerSeasons: PlayerCareerStatsRow[];
  recentGames: PlayerGameLog[];
};

type SeasonStats = {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  mins: number;
};

const HEADSHOT_BASE = "https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190";
// const HEADSHOT_FALLBACK = "https://images.unsplash.com/photo-1521412644187-c49fa049e84d?auto=format&fit=crop&w=600&q=80";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function deslugify(slug: string | undefined): string {
  if (!slug) return "";
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function round(value: number | null | undefined, digits = 1): number {
  if (value === null || value === undefined) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function deriveRating(stats?: SeasonStats): number {
  if (!stats) return 75;
  const raw = stats.pts * 2 + stats.reb * 1.5 + stats.ast * 1.5 + stats.stl * 1.2 + stats.blk * 1.2;
  return Math.min(99, Math.round(65 + raw * 0.6));
}

function formatRecord(stats?: TeamStatsRow): string | undefined {
  if (!stats) return undefined;
  return `${stats.wins}-${stats.losses} (${Math.round(stats.win_pct * 100)}% W)`;
}

function formatAverage(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return value.toFixed(digits);
}

function formatInteger(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  // If it's a whole number, return without decimals; otherwise show 1 decimal place
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return value.toFixed(1);
}

function formatPerGame(
  total: number | null | undefined,
  games: number | null | undefined,
  digits = 1,
): string {
  if (!games || games <= 0 || total === null || total === undefined || Number.isNaN(total)) {
    return "—";
  }
  return (total / games).toFixed(digits);
}

function formatPercentage(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${(value * 100).toFixed(digits)}%`;
}

function selectSeasonRow(rows: PlayerCareerStatsRow[], seasonId: string): PlayerCareerStatsRow | undefined {
  const exact =
    rows.find((row) => row.season_id === seasonId && row.team_abbreviation !== "TOT") ||
    rows.find((row) => row.season_id === seasonId);
  if (exact) {
    return exact;
  }

  return [...rows].sort((a, b) => a.season_id.localeCompare(b.season_id)).pop();
}

function collapseCareerRows(rows: PlayerCareerStatsRow[]): PlayerCareerStatsRow[] {
  const bySeason = new Map<string, PlayerCareerStatsRow>();
  rows.forEach((row) => {
    if (!bySeason.has(row.season_id) || row.team_abbreviation === "TOT") {
      bySeason.set(row.season_id, row);
    }
  });
  return [...bySeason.values()].sort((a, b) => b.season_id.localeCompare(a.season_id));
}

async function fetchPlayerProfile(slug: string | undefined): Promise<PlayerProfile | null> {
  if (!slug) {
    return null;
  }
  const query = deslugify(slug);
  if (!query) {
    return null;
  }
  const resolution = await nbaFetch<ResolveResult>(`/v1/resolve?player=${encodeURIComponent(query)}`);
  const playerId = resolution.player?.id;
  if (!playerId) {
    return null;
  }

  const [career, gamelog] = await Promise.all([
    nbaFetch<PlayerCareerStatsRow[]>(`/v1/players/${playerId}/career`, { next: { revalidate: 3600 } }),
    nbaFetch<PlayerGameLog[]>(`/v1/players/${playerId}/gamelog?season=${DEFAULT_SEASON}`, { next: { revalidate: 300 } }),
  ]);

  if (!career.length) {
    return null;
  }

  const seasonRow = selectSeasonRow(career, DEFAULT_SEASON);
  let teamStats: TeamStatsRow[] = [];
  if (seasonRow?.team_id != null) {
    try {
      teamStats = await nbaFetch<TeamStatsRow[]>(
        `/v1/teams/${seasonRow.team_id}/stats?season=${DEFAULT_SEASON}&measure=Base&per_mode=PerGame`,
        { next: { revalidate: 1800 } },
      );
    } catch (error) {
      console.error("Failed to load team stats", error);
      teamStats = [];
    }
  }

  const gamesPlayed = seasonRow?.games_played ?? 0;
  const perGame = (value: number | null | undefined): number => {
    if (!seasonRow || !gamesPlayed || value === null || value === undefined) {
      return 0;
    }
    return round(value / gamesPlayed);
  };
  const stats: SeasonStats | undefined = seasonRow
    ? {
        pts: perGame(seasonRow.points),
        reb: perGame(seasonRow.rebounds),
        ast: perGame(seasonRow.assists),
        stl: perGame(seasonRow.steals),
        blk: perGame(seasonRow.blocks),
        mins: perGame(seasonRow.minutes),
      }
    : undefined;

  const teamRecord = formatRecord(teamStats[0]);
  const rating = deriveRating(stats);
  const scoutingReport = stats
    ? `${resolution.player?.name ?? query} is pacing ${stats.pts.toFixed(1)} / ${stats.reb.toFixed(1)} / ${stats.ast.toFixed(1)} this season.`
    : `${resolution.player?.name ?? query} career overview.`;

  const experienceSeasons = collapseCareerRows(career).length;

  return {
    slug,
    playerId,
    name: resolution.player?.name ?? query,
    team: teamStats[0]?.team_name ?? seasonRow?.team_abbreviation ?? resolution.player?.abbreviation ?? "Free Agent",
    teamAbbreviation: seasonRow?.team_abbreviation ?? teamStats[0]?.team_abbreviation ?? null,
    headshot: `${HEADSHOT_BASE}/${playerId}.png`,
    rating,
    scoutingReport,
    age: seasonRow?.player_age,
    experience: experienceSeasons ? `${experienceSeasons} season${experienceSeasons === 1 ? "" : "s"}` : "Rookie",
    currentSeason: stats
      ? {
        seasonId: seasonRow?.season_id ?? DEFAULT_SEASON,
        teamRecord,
        stats,
        insights: [
          { label: "Games played", value: String(seasonRow?.games_played ?? "—") },
          { label: "Games started", value: String(seasonRow?.games_started ?? "—") },
          { label: "Wins / Losses", value: teamRecord ?? "—" },
        ],
      }
      : undefined,
    careerSeasons: collapseCareerRows(career),
    recentGames: gamelog.slice(0, 5),
  };
}

export async function generateStaticParams() {
  try {
    const players = await nbaFetch<Player[]>(`/v1/players?season=${DEFAULT_SEASON}&page_size=20`);
    return players.slice(0, 12).map((player) => ({ slug: slugify(player.full_name) }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> | { slug: string } }): Promise<Metadata> {
  try {
    const resolvedParams = await Promise.resolve(params);
    const profile = await fetchPlayerProfile(resolvedParams.slug);
    if (!profile) {
      return {
        title: "Player not found · NBAI",
        description: "We could not locate that player in the NBA data service.",
      };
    }
    return {
      title: `${profile.name} · NBAI`,
      description: `${profile.name} overview powered by nba_api data.`,
    };
  } catch {
    return {
      title: "NBAI Player Profile",
    };
  }
}

export default async function PlayerPage({ params }: { params: Promise<{ slug: string }> | { slug: string } }) {
  const resolvedParams = await Promise.resolve(params);
  const profile = await fetchPlayerProfile(resolvedParams.slug);
  if (!profile) {
    notFound();
  }
  const activeSeasonId = profile.currentSeason?.seasonId;
  const isCurrentSeason = activeSeasonId === DEFAULT_SEASON;
  const eyebrowText =
    activeSeasonId && !isCurrentSeason
      ? "Last Active Season"
      : `${profile.teamAbbreviation ?? "NBA"} · ${activeSeasonId ?? DEFAULT_SEASON}`;
  const seasonRating = "A-";

  return (
    <>
      <section className="rounded-3xl border border-white/10 bg-linear-to-br from-blue-600/40 via-slate-900/80 to-slate-950/80 px-8 py-10 shadow-2xl shadow-blue-500/40">
        <div className="flex flex-col gap-10 md:flex-row md:items-center md:justify-between">
          <div className="space-y-6 text-white">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-blue-200/70">
                {eyebrowText}
              </p>
              <h1 className="mt-4 text-4xl font-semibold md:text-5xl">
                {profile.name}
                <span className="ml-3 text-base font-normal text-white/70">
                  {profile.teamAbbreviation ? `· ${profile.teamAbbreviation}` : ""}
                </span>
              </h1>
            </div>
            <p className="text-sm text-white/70 md:max-w-2xl">{profile.scoutingReport}</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <InfoPill label="Age" value={profile.age ? `${profile.age}` : "—"} />
              <InfoPill label="Experience" value={profile.experience} />
              <InfoPill label="Team record" value={profile.currentSeason?.teamRecord ?? "—"} />
            </div>
            <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-5 md:flex-row md:items-center">
              <div className="flex-1">
                <p className="text-xs uppercase tracking-[0.4em] text-white/60">Career rating</p>
                <p className="text-5xl font-semibold text-white">{profile.rating}</p>
                <div className="mt-3 h-2 rounded-full bg-white/10">
                  <div className="h-2 rounded-full bg-blue-400" style={{ width: `${Math.min(profile.rating, 100)}%` }} />
                </div>
                <p className="mt-2 text-xs text-white/60">Derived from per-game production</p>
              </div>
            </div>
          </div>
          <div className="mx-auto w-full max-w-xs md:mx-0 md:max-w-sm">
            <div className="rounded-4xl border border-white/20 bg-white/10 p-3 backdrop-blur">
              <div
                className="h-60 rounded-[28px] border border-white/30 bg-cover bg-center shadow-inner shadow-black/40"
                style={{ backgroundImage: `url(${profile.headshot})` }}
              />
            </div>
          </div>
        </div>
      </section>

      {profile.currentSeason?.stats ? (
        <section className="mt-16">
          <SectionHeading
            eyebrow={eyebrowText}
            title={`${profile.currentSeason.seasonId} production`}
            rightSlot={
              <div className="text-right text-white">
                <p className="text-[0.6rem] uppercase tracking-[0.45em] text-white/60">Season rating</p>
                <p className="text-5xl font-black leading-none text-white">{seasonRating}</p>
              </div>
            }
          />
          <div className="grid gap-5 md:grid-cols-3">
            <StatCard label="Points" value={profile.currentSeason.stats.pts} suffix="PPG" />
            <StatCard label="Rebounds" value={profile.currentSeason.stats.reb} suffix="RPG" />
            <StatCard label="Assists" value={profile.currentSeason.stats.ast} suffix="APG" />
            <StatCard label="Steals" value={profile.currentSeason.stats.stl} suffix="SPG" />
            <StatCard label="Blocks" value={profile.currentSeason.stats.blk} suffix="BPG" />
            <StatCard label="Minutes" value={profile.currentSeason.stats.mins} suffix="MPG" />
          </div>
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
              <p className="text-xs uppercase tracking-[0.4em] text-white/50">Recent games</p>
              <div className="mt-4 space-y-4">
                {profile.recentGames.length === 0 ? (
                  <p className="text-sm text-white/60">No game logs yet for {DEFAULT_SEASON}.</p>
                ) : (
                  profile.recentGames.map((game) => (
                    <div
                      key={game.game_id}
                      className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-white/80"
                    >
                      <div>
                        <p className="font-semibold text-white">{game.matchup}</p>
                        <p className="text-xs text-white/50">{new Date(game.game_date).toLocaleDateString()}</p>
                      </div>
                      <div className="flex gap-4 text-right text-white">
                        <span>{game.points} pts</span>
                        <span>{game.rebounds} reb</span>
                        <span>{game.assists} ast</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
              <p className="text-xs uppercase tracking-[0.4em] text-white/50">Season insights</p>
              <div className="mt-4 grid gap-4">
                {profile.currentSeason.insights.map((insight) => (
                  <div key={insight.label} className="rounded-2xl border border-white/5 bg-white/5 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.3em] text-white/50">{insight.label}</p>
                    <p className="mt-1 text-xl font-semibold text-white">{insight.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mt-20">
        <SectionHeading eyebrow="Career resume" title="Season-by-season averages" />
        <div className="overflow-x-auto rounded-3xl border border-white/10 bg-slate-950/60">
          <table className="min-w-full divide-y divide-white/5 text-xs sm:text-sm">
            <thead className="text-left text-[0.65rem] uppercase tracking-[0.35em] text-white/40 sm:text-[0.7rem]">
              <tr>
                <th className="px-4 py-3">Season</th>
                <th className="px-4 py-3">Team</th>
                <th className="px-4 py-3">PPG</th>
                <th className="px-4 py-3">RPG</th>
                <th className="px-4 py-3">APG</th>
                <th className="px-4 py-3">SPG</th>
                <th className="px-4 py-3">BPG</th>
                <th className="px-4 py-3">FG%</th>
                <th className="px-4 py-3">3P%</th>
                <th className="px-4 py-3">FT%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white/80">
              {profile.careerSeasons.map((season) => (
                <tr key={`avg-${season.season_id}-${season.team_abbreviation ?? "tot"}`} className="hover:bg-white/5">
                  <td className="px-4 py-2 font-semibold text-white">{season.season_id}</td>
                  <td className="px-4 py-2">{season.team_abbreviation ?? "—"}</td>
                  <td className="px-4 py-2">{formatPerGame(season.points, season.games_played)}</td>
                  <td className="px-4 py-2">{formatPerGame(season.rebounds, season.games_played)}</td>
                  <td className="px-4 py-2">{formatPerGame(season.assists, season.games_played)}</td>
                  <td className="px-4 py-2">{formatPerGame(season.steals, season.games_played)}</td>
                  <td className="px-4 py-2">{formatPerGame(season.blocks, season.games_played)}</td>
                  <td className="px-4 py-2">{formatPercentage(season.field_goal_pct)}</td>
                  <td className="px-4 py-2">{formatPercentage(season.three_point_pct)}</td>
                  <td className="px-4 py-2">{formatPercentage(season.free_throw_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-12">
        <SectionHeading eyebrow="Career resume" title="Season-by-season totals" />
        <div className="overflow-x-auto rounded-3xl border border-white/10 bg-slate-950/60">
          <table className="min-w-full divide-y divide-white/5 text-xs sm:text-sm">
            <thead className="text-left text-[0.65rem] uppercase tracking-[0.3em] text-white/40 sm:text-[0.7rem]">
              <tr>
                <th className="px-4 py-3">Season</th>
                <th className="px-4 py-3">Team</th>
                <th className="px-4 py-3">GP</th>
                <th className="px-4 py-3">MIN</th>
                <th className="px-4 py-3">PTS</th>
                <th className="px-4 py-3">REB</th>
                <th className="px-4 py-3">AST</th>
                <th className="px-4 py-3">STL</th>
                <th className="px-4 py-3">BLK</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white/80">
              {profile.careerSeasons.map((season) => (
                <tr key={`tot-${season.season_id}-${season.team_abbreviation ?? "tot"}`} className="hover:bg-white/5">
                  <td className="px-4 py-2 font-semibold text-white">{season.season_id}</td>
                  <td className="px-4 py-2">{season.team_abbreviation ?? "—"}</td>
                  <td className="px-4 py-2">{season.games_played}</td>
                  <td className="px-4 py-2">{formatInteger(season.minutes)}</td>
                  <td className="px-4 py-2">{formatInteger(season.points)}</td>
                  <td className="px-4 py-2">{formatInteger(season.rebounds)}</td>
                  <td className="px-4 py-2">{formatInteger(season.assists)}</td>
                  <td className="px-4 py-2">{formatInteger(season.steals)}</td>
                  <td className="px-4 py-2">{formatInteger(season.blocks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

const SectionHeading = ({ eyebrow, title, rightSlot }: { eyebrow: string; title: string; rightSlot?: ReactNode }) => (
  <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <p className="text-xs uppercase tracking-[0.35em] text-blue-300/80">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold text-white">{title}</h2>
    </div>
    {rightSlot ? <div className="flex-shrink-0">{rightSlot}</div> : null}
  </div>
);

const StatCard = ({ label, value, suffix }: { label: string; value: number; suffix: string }) => (
  <article className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/30">
    <p className="text-xs uppercase tracking-[0.3em] text-white/50">{label}</p>
    <p className="mt-3 text-3xl font-semibold text-white">
      {value.toFixed(1)}
      <span className="ml-1 text-sm text-white/60">{suffix}</span>
    </p>
  </article>
);

const InfoPill = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
    <p className="text-xs uppercase tracking-[0.3em] text-white/50">{label}</p>
    <p className="mt-1 text-base font-semibold text-white">{value}</p>
  </div>
);
