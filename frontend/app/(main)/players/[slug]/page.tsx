import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { DEFAULT_SEASON, nbaFetch } from "@/lib/nbaApi";
import { containsBannedTerm } from "@/lib/utils";
import AwardsAccordion from "@/components/AwardsAccordion";

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
  true_shooting_pct: number | null;
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
  steals?: number | null;
  blocks?: number | null;
  turnovers?: number | null;
  plus_minus?: number | null;
};

type Player = {
  id: number;
  full_name: string;
};

type PlayerAward = {
  season: string;
  description: string;
  team?: string | null;
  conference?: string | null;
  award_type?: string | null;
  subtype1?: string | null;
  subtype2?: string | null;
  subtype3?: string | null;
  month?: string | null;
  week?: string | null;
  all_nba_team_number?: number | null;
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
  awards: PlayerAward[];
  rings: number;
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

const CHAMPIONS_BY_SEASON: Record<string, string> = {
  "2024-25": "OKC",
  "2023-24": "BOS",
  "2022-23": "DEN",
  "2021-22": "GSW",
  "2020-21": "MIL",
  "2019-20": "LAL",
  "2018-19": "TOR",
  "2017-18": "GSW",
  "2016-17": "GSW",
  "2015-16": "CLE",
  "2014-15": "GSW",
  "2013-14": "SAS",
  "2012-13": "MIA",
  "2011-12": "MIA",
  "2010-11": "DAL",
  "2009-10": "LAL",
  "2008-09": "LAL",
  "2007-08": "BOS",
  "2006-07": "SAS",
  "2005-06": "MIA",
  "2004-05": "SAS",
  "2003-04": "DET",
  "2002-03": "SAS",
  "2001-02": "LAL",
  "2000-01": "LAL",
  "1999-00": "LAL",
  "1998-99": "SAS",
  "1997-98": "CHI",
  "1996-97": "CHI",
  "1995-96": "CHI",
  "1994-95": "HOU",
  "1993-94": "HOU",
  "1992-93": "CHI",
  "1991-92": "CHI",
  "1990-91": "CHI",
  "1989-90": "DET",
  "1988-89": "DET",
  "1987-88": "LAL",
  "1986-87": "LAL",
  "1985-86": "BOS",
};

const MIN_GAMES_FOR_ACCOLADE = 45;
const PRIME_IMPACT_MIN_GAMES = 50;

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

function safeAverage(total: number | null | undefined, games: number | null | undefined): number {
  if (total === null || total === undefined || !games || games <= 0) {
    return 0;
  }
  return total / games;
}

function createSeededGenerator(seedSource: string): () => number {
  let seed = 0;
  for (let i = 0; i < seedSource.length; i += 1) {
    seed = (seed * 31 + seedSource.charCodeAt(i)) >>> 0;
  }
  if (seed === 0) {
    seed = 1;
  }
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

const normalizeAwardSummary = (awards: PlayerAward[], ringCount: number) => {
  const summary = {
    allStar: 0,
    allNba: 0,
    allDefense: 0,
    mvp: 0,
    cpoy: 0,
  };

  awards.forEach((award) => {
    const haystack = `${award.description ?? ""} ${award.award_type ?? ""}`.toLowerCase();
    if (haystack.match(/all[-\s]?star/)) {
      summary.allStar += 1;
    }
    if (haystack.match(/all[-\s]?nba/)) {
      summary.allNba += 1;
    }
    if (haystack.match(/all[-\s]?(defense|defensive)/)) {
      summary.allDefense += 1;
    }
    if (haystack.includes("clutch") || haystack.includes("cpoy")) {
      summary.cpoy += 1;
    }
    const isFinals = haystack.includes("finals");
    if ((haystack.includes("mvp") || haystack.includes("most valuable player")) && !isFinals) {
      summary.mvp += 1;
    }
  });

  const items: { label: string; count: number }[] = [];
  if (summary.allStar) items.push({ label: "All-Star", count: summary.allStar });
  if (summary.allNba) items.push({ label: "All-NBA", count: summary.allNba });
  if (summary.allDefense) items.push({ label: "All-Defense", count: summary.allDefense });
  if (summary.mvp) items.push({ label: "MVP", count: summary.mvp });
  if (summary.cpoy) items.push({ label: "CPOY", count: summary.cpoy });
  if (ringCount) items.push({ label: "Rings", count: ringCount });
  return items;
};

const filterAwards = (awards: PlayerAward[]) =>
  awards.filter((award) => {
    const haystack = `${award.description ?? ""} ${award.award_type ?? ""}`.toLowerCase();
    return !haystack.match(/player of the (week|month)|potw|potm/);
  });

const extractAllStarSeasons = (awards: PlayerAward[]) => {
  const set = new Set<string>();
  awards.forEach((award) => {
    const haystack = `${award.description ?? ""} ${award.award_type ?? ""}`.toLowerCase();
    if (haystack.match(/all[-\s]?star/)) {
      if (award.season) {
        set.add(award.season);
      }
    }
  });
  return set;
};

function computePerGameImpact(stats: SeasonStats): number {
  const scoring = stats.pts * 1.25;
  const playmaking = stats.ast * 1.4;
  const rebounding = stats.reb * 0.95;
  const defensiveStocks = (stats.stl + stats.blk) * 2.4;
  const workload = Math.max(0, stats.mins - 26) * 0.7;
  return scoring + playmaking + rebounding + defensiveStocks + workload;
}

function isAllStarCaliber(row: PlayerCareerStatsRow): boolean {
  if (!row.games_played || row.games_played < MIN_GAMES_FOR_ACCOLADE) {
    return false;
  }
  const pts = safeAverage(row.points, row.games_played);
  const reb = safeAverage(row.rebounds, row.games_played);
  const ast = safeAverage(row.assists, row.games_played);
  const stocks = safeAverage(row.steals ?? 0, row.games_played) + safeAverage(row.blocks ?? 0, row.games_played);
  const impact = pts * 0.85 + reb * 0.45 + ast * 0.55 + stocks * 1.5;
  return impact >= 28 || pts >= 24 || (pts >= 20 && (reb >= 9 || ast >= 7));
}

function estimateCareerAccolades(rows?: PlayerCareerStatsRow[]): { allStarSeasons: number; championships: number } {
  if (!rows?.length) {
    return { allStarSeasons: 0, championships: 0 };
  }

  const primaryRows = new Map<string, PlayerCareerStatsRow>();
  const championSeasons = new Set<string>();

  rows.forEach((row) => {
    if (!primaryRows.has(row.season_id) || row.team_abbreviation === "TOT") {
      primaryRows.set(row.season_id, row);
    }
    const champion = CHAMPIONS_BY_SEASON[row.season_id];
    if (
      champion &&
      row.team_abbreviation &&
      row.team_abbreviation !== "TOT" &&
      champion === row.team_abbreviation
    ) {
      championSeasons.add(row.season_id);
    }
  });

  let allStarSeasons = 0;
  for (const row of primaryRows.values()) {
    if (isAllStarCaliber(row)) {
      allStarSeasons += 1;
    }
  }

  return { allStarSeasons, championships: championSeasons.size };
}

type CareerImpactSummary = {
  seasons: number;
  primeImpactSeasons: number;
  peakScoring: number;
};

function summarizeCareerImpact(rows?: PlayerCareerStatsRow[]): CareerImpactSummary {
  if (!rows?.length) {
    return { seasons: 0, primeImpactSeasons: 0, peakScoring: 0 };
  }

  const bySeason = new Map<string, PlayerCareerStatsRow>();
  rows.forEach((row) => {
    if (!bySeason.has(row.season_id) || row.team_abbreviation === "TOT") {
      bySeason.set(row.season_id, row);
    }
  });

  let primeImpactSeasons = 0;
  let peakScoring = 0;
  const seasons = [...bySeason.values()];

  seasons.forEach((row) => {
    const games = row.games_played ?? 0;
    if (!games) {
      return;
    }
    const pts = safeAverage(row.points, games);
    const ast = safeAverage(row.assists, games);
    const reb = safeAverage(row.rebounds, games);
    peakScoring = Math.max(peakScoring, pts);
    if (
      games >= PRIME_IMPACT_MIN_GAMES &&
      (pts >= 24 || (pts >= 20 && ast >= 8) || (pts >= 18 && reb >= 10) || (pts >= 18 && ast >= 10))
    ) {
      primeImpactSeasons += 1;
    }
  });

  return {
    seasons: seasons.length,
    primeImpactSeasons,
    peakScoring,
  };
}

// Harsher rating heuristic that folds in career accomplishments.
function deriveRating(stats?: SeasonStats, career?: PlayerCareerStatsRow[]): number {
  const talentScore = stats ? Math.min(36, computePerGameImpact(stats) * 0.5) : 0;
  const { allStarSeasons, championships } = estimateCareerAccolades(career);
  const allStarScore = Math.min(9, allStarSeasons * 1.4);
  const championshipScore = championships === 0 ? 0 : Math.min(12, 6 + (championships - 1) * 2.5);
  const accoladeScore = allStarScore + championshipScore;
  const careerImpact = summarizeCareerImpact(career);
  const experienceBoost = Math.min(14, careerImpact.seasons * 0.4 + careerImpact.primeImpactSeasons);
  const peakResume = Math.min(7, Math.max(0, careerImpact.peakScoring - 23) * 0.35);
  const heavyMinutesBonus = stats ? Math.max(0, stats.mins - 34) * 0.2 : 0;
  const noRingPenalty = championships === 0 ? 3 : 0;
  const base = (stats ? 59 : 56) + talentScore + accoladeScore + experienceBoost + peakResume + heavyMinutesBonus - noRingPenalty;
  const ceiling = championships > 0 ? 98 : 95;
  const bounded = Math.min(ceiling, base);
  const floor = stats ? 63 : 58;
  return Math.max(floor, Math.round(bounded));
}

function formatRecord(stats?: TeamStatsRow): string | undefined {
  if (!stats) return undefined;
  return `${stats.wins}-${stats.losses} (${Math.round(stats.win_pct * 100)}% W)`;
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
  try {
    const query = deslugify(slug);
    if (!query) {
      return null;
    }
    if (containsBannedTerm(query) || containsBannedTerm(slug)) {
      return null;
    }
    const resolution = await nbaFetch<ResolveResult>(`/v1/resolve?player=${encodeURIComponent(query)}`);
    const playerId = resolution.player?.id;
    if (!playerId) {
      return null;
    }

    const [career, gamelog, awards] = await Promise.all([
      nbaFetch<PlayerCareerStatsRow[]>(`/v1/players/${playerId}/career`, { next: { revalidate: 3600 } }),
      nbaFetch<PlayerGameLog[]>(`/v1/players/${playerId}/gamelog?season=${DEFAULT_SEASON}`, { next: { revalidate: 300 } }),
      (async () => {
        try {
          return await nbaFetch<PlayerAward[]>(`/v1/players/${playerId}/awards`, { next: { revalidate: 3600 } });
        } catch (awardError) {
          if (process.env.NODE_ENV !== "production") {
            console.error("Failed to load player awards", awardError);
          }
          return [] as PlayerAward[];
        }
      })(),
    ]);

    if (!career.length) {
      return null;
    }

    const seasonRow = selectSeasonRow(career, DEFAULT_SEASON);
    const statsSeasonId = seasonRow?.season_id ?? DEFAULT_SEASON;
    let teamStats: TeamStatsRow[] = [];
    if (seasonRow?.team_id != null) {
      try {
        teamStats = await nbaFetch<TeamStatsRow[]>(
          `/v1/teams/${seasonRow.team_id}/stats?season=${statsSeasonId}&measure=Base&per_mode=PerGame`,
          { next: { revalidate: 1800 } },
        );
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.error("Failed to load team stats", error);
        }
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
    const rating = deriveRating(stats, career);
    const isActive = seasonRow?.season_id === DEFAULT_SEASON;
    const scoutingReport = stats
      ? isActive
        ? `${resolution.player?.name ?? query} is pacing ${stats.pts.toFixed(1)} / ${stats.reb.toFixed(1)} / ${stats.ast.toFixed(1)} this season.`
        : `${resolution.player?.name ?? query} averaged ${stats.pts.toFixed(1)} / ${stats.reb.toFixed(1)} / ${stats.ast.toFixed(1)} in ${seasonRow?.season_id ?? "his last season"}.`
      : `${resolution.player?.name ?? query} career overview.`;

    const collapsedCareer = collapseCareerRows(career);
    const experienceSeasons = collapsedCareer.length;
    const { championships } = estimateCareerAccolades(career);

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
          seasonId: statsSeasonId,
          teamRecord,
          stats,
          insights: [
            { label: "Games played", value: String(seasonRow?.games_played ?? "—") },
            { label: "Games started", value: String(seasonRow?.games_started ?? "—") },
            { label: "Wins / Losses", value: teamRecord ?? "—" },
          ],
        }
        : undefined,
      careerSeasons: collapsedCareer,
      recentGames: gamelog.slice(0, 5),
      awards: filterAwards(awards),
      rings: championships,
    };
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Failed to build player profile", { slug, error });
    }
    throw error;
  }
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
        title: "Player not found · ShAI",
        description: "We could not locate that player in the NBA data service.",
      };
    }
    return {
      title: `${profile.name} · ShAI`,
      description: `${profile.name} overview powered by nba_api data.`,
    };
  } catch {
    return {
      title: "ShAI Player Profile",
    };
  }
}

const MissingPlayer = ({ name }: { name: string }) => (
  <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-4 text-center text-[color:var(--color-app-foreground)]">
    <p className="text-xs uppercase tracking-[0.5em] text-[color:rgba(var(--color-app-foreground-rgb),0.45)]">Player lookup</p>
    <h1 className="text-3xl font-semibold">Sorry, this player doesn&apos;t exist.</h1>
    <p className="text-sm text-[color:var(--color-app-foreground-muted)]">We couldn&apos;t locate a profile for &quot;{name}&quot;. Double-check the spelling or try another search.</p>
    <Link
      href="/players"
      className="rounded-full border border-[color:var(--color-app-border)] px-5 py-2 text-sm font-semibold text-[color:var(--color-app-foreground)] transition hover:border-[color:var(--color-app-border-strong)] hover:bg-[color:rgba(var(--color-app-foreground-rgb),0.05)]"
    >
      Back to player index
    </Link>
  </div>
);

export default async function PlayerPage({ params }: { params: Promise<{ slug: string }> | { slug: string } }) {
  const resolvedParams = await Promise.resolve(params);
  let profile: PlayerProfile | null = null;
  try {
    profile = await fetchPlayerProfile(resolvedParams.slug);
  } catch {
    return <MissingPlayer name={deslugify(resolvedParams.slug)} />;
  }
  if (!profile) {
    return <MissingPlayer name={deslugify(resolvedParams.slug)} />;
  }
  const activeSeasonId = profile.currentSeason?.seasonId;
  const isActive = activeSeasonId === DEFAULT_SEASON;
  const eyebrowText =
    activeSeasonId && !isActive
      ? "Last Active Season"
      : `${profile.teamAbbreviation ?? "NBA"} · ${activeSeasonId ?? DEFAULT_SEASON}`;
  const seasonRating = "A-";
  const gradeOptions = ["A+", "A", "A-", "B+", "B"];
  const mockMatchups = ["vs BOS", "@ LAL", "vs DEN", "@ MIA", "vs DAL", "@ PHX"];
  const statKeys = ["PTS", "REB", "AST", "STL", "BLK", "3PM"];
  const mockPerformanceBase = Date.UTC(2024, 0, 20);
  const seededRandom = createSeededGenerator(`${profile.playerId}-${profile.slug}`);
  const randomInRange = (min: number, max: number, decimals = 0) => (min + seededRandom() * (max - min)).toFixed(decimals);
  const randomValueForStat = (label: string) => {
    switch (label) {
      case "PTS":
        return randomInRange(15, 40, 0);
      case "REB":
        return randomInRange(5, 11, 0);
      case "AST":
        return randomInRange(4, 9, 0);
      case "STL":
      case "BLK":
        return randomInRange(1, 3, 1);
      case "3PM":
        return randomInRange(1, 5, 1);
      default:
        return randomInRange(2, 12, 1);
    }
  };
  const generateMockStats = () => {
    const shuffled = [...statKeys]
      .map((label) => ({ label, sort: seededRandom() }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ label }) => label);
    return shuffled.slice(0, 3).map((label) => ({
      label,
      value: randomValueForStat(label),
    }));
  };
  const topPerformances = Array.from({ length: 3 }, (_, index) => ({
    game: mockMatchups[index % mockMatchups.length],
    date: new Date(mockPerformanceBase - index * 86400000).toLocaleDateString(),
    grade: gradeOptions[(Math.floor(seededRandom() * gradeOptions.length) + index) % gradeOptions.length],
    stats: generateMockStats(),
  }));
  const awardSummary = normalizeAwardSummary(profile.awards, profile.rings);
  const allStarSeasons = extractAllStarSeasons(profile.awards);
  const showTrueShooting = profile.careerSeasons.some(
    (season) => season.true_shooting_pct !== null && season.true_shooting_pct !== undefined,
  );
  const renderSeasonLabel = (seasonId: string) => (
    <span className="inline-flex items-center gap-1">
      {seasonId}
      {allStarSeasons.has(seasonId) ? (
        <span className="text-[color:var(--color-app-primary)]" aria-label="All-Star season" title="All-Star season">
          ★
        </span>
      ) : null}
    </span>
  );

  return (
    <>
      <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="w-full rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface)] px-5 py-5 shadow-lg shadow-[rgba(10,31,68,0.08)]">
          <div className="flex h-full flex-col gap-4 text-[color:var(--color-app-foreground)]">
            <div className="flex items-center gap-4">
              <div className="shrink-0 rounded-full border border-[color:rgba(var(--color-app-foreground-rgb),0.15)] bg-[color:rgba(var(--color-app-foreground-rgb),0.08)] p-2 backdrop-blur">
                <div
                  className="h-28 w-28 rounded-full border border-[color:rgba(var(--color-app-foreground-rgb),0.35)] bg-cover bg-center shadow-inner shadow-black/40 md:h-32 md:w-32"
                  style={{ backgroundImage: `url(${profile.headshot})` }}
                />
              </div>
              <div>
                <p className="text-[0.65rem] uppercase tracking-[0.45em] text-[color:rgba(var(--color-app-primary-rgb),0.65)]">
                  {eyebrowText}
                </p>
                <h1 className="mt-2 text-3xl font-semibold md:text-4xl">
                  {profile.name}
                  <span className="ml-2 text-base font-normal text-[color:rgba(var(--color-app-foreground-rgb),0.65)]">
                    {profile.teamAbbreviation ? `· ${profile.teamAbbreviation}` : ""}
                  </span>
                </h1>
              </div>
            </div>
            <p className="text-sm text-[color:var(--color-app-foreground-muted)]">{profile.scoutingReport}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <InfoPill label="Age" value={profile.age ? `${profile.age}` : "—"} />
              <InfoPill label="Experience" value={profile.experience} />
              <InfoPill label="Team record" value={profile.currentSeason?.teamRecord ?? "—"} />
            </div>
            <div className="flex items-center gap-4 rounded-2xl border border-[color:var(--color-app-border)] bg-[color:rgba(var(--color-app-foreground-rgb),0.05)] p-3">
              <p className="text-[0.65rem] uppercase tracking-[0.4em] text-[color:rgba(var(--color-app-foreground-rgb),0.6)]">Career rating</p>
              <div className="flex flex-1 items-center gap-3">
                <p className="text-3xl font-semibold text-[color:var(--color-app-foreground)]">{profile.rating}</p>
                <div className="flex-1">
                  <div className="h-1.5 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.15)]">
                    <div className="h-1.5 rounded-full bg-[color:var(--color-app-primary)]" style={{ width: `${Math.min(profile.rating, 100)}%` }} />
                  </div>
                  <p className="mt-1 text-[0.7rem] text-[color:rgba(var(--color-app-foreground-rgb),0.6)]">Per-game impact metric</p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-background-soft)] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[0.65rem] uppercase tracking-[0.4em] text-[color:rgba(var(--color-app-foreground-rgb),0.6)]">
                  Career awards
                </p>
                {profile.awards.length > 0 ? (
                  <span className="text-xs font-semibold text-[color:var(--color-app-foreground-muted)]">
                    {profile.awards.length}
                  </span>
                ) : null}
              </div>
              {awardSummary.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {awardSummary.map((item) => (
                    <span
                      key={item.label}
                      className="inline-flex items-center gap-1 rounded-full border border-[color:rgba(var(--color-app-foreground-rgb),0.15)] bg-[color:rgba(var(--color-app-foreground-rgb),0.05)] px-3 py-1 text-[0.75rem] font-medium text-[color:var(--color-app-foreground)]"
                    >
                      {item.label}
                      <span className="text-[color:var(--color-app-foreground-muted)]">x{item.count}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              {profile.awards.length === 0 ? (
                <p className="mt-2 text-sm text-[color:var(--color-app-foreground-muted)]">No official league awards recorded.</p>
              ) : (
                <AwardsAccordion awards={profile.awards} />
              )}
            </div>
          </div>
        </section>
        <aside className="flex h-full w-full flex-col rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)] p-5 text-[color:var(--color-app-foreground)] shadow-xl shadow-[rgba(10,31,68,0.15)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.45em] text-[color:rgba(var(--color-app-foreground-rgb),0.55)]">Season</p>
              <h2 className="text-xl font-semibold">Top Performances</h2>
            </div>
            <span className="text-xs text-[color:rgba(var(--color-app-foreground-rgb),0.65)]">{profile.currentSeason?.seasonId ?? DEFAULT_SEASON}</span>
          </div>
          <div className="mt-4 flex-1 space-y-3">
            {topPerformances.map((perf, index) => (
              <div
                key={`${perf.game}-${index}`}
                className="rounded-2xl border border-[color:var(--color-app-border)] bg-[color:rgba(var(--color-app-foreground-rgb),0.05)] px-4 py-3"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-[color:rgba(var(--color-app-foreground-rgb),0.6)]">{perf.game}</p>
                    <p className="text-sm text-[color:var(--color-app-foreground-muted)]">{perf.date}</p>
                  </div>
                  <span className="rounded-full border border-[color:rgba(var(--color-app-foreground-rgb),0.25)] px-3 py-1 text-sm font-semibold text-[color:var(--color-app-foreground)]">
                    {perf.grade}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                  {perf.stats.map((stat) => (
                    <span
                      key={stat.label}
                      className="rounded-full border border-[color:rgba(var(--color-app-foreground-rgb),0.15)] bg-[color:rgba(var(--color-app-foreground-rgb),0.08)] px-3 py-1 text-[color:var(--color-app-foreground)]"
                    >
                      <span className="text-[color:var(--color-app-foreground-muted)]">{stat.label}</span>{" "}
                      <span className="font-semibold">{stat.value}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {profile.currentSeason?.stats ? (
        <section className="mt-16">
          <SectionHeading
            eyebrow={eyebrowText}
            title={`${profile.currentSeason.seasonId} production`}
            rightSlot={
              <div className="text-right text-[color:var(--color-app-foreground)]">
                <p className="text-[0.6rem] uppercase tracking-[0.45em] text-[color:rgba(var(--color-app-foreground-rgb),0.6)]">Season rating</p>
                <p className="text-5xl font-black leading-none">{seasonRating}</p>
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
            <div className="rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface)] p-6">
              <p className="text-xs uppercase tracking-[0.4em] text-[color:rgba(var(--color-app-foreground-rgb),0.55)]">Recent games</p>
              <div className="mt-4 space-y-4">
                {profile.recentGames.length === 0 ? (
                  <p className="text-sm text-[color:var(--color-app-foreground-muted)]">No game logs yet for {DEFAULT_SEASON}.</p>
                ) : (
                  profile.recentGames.map((game) => (
                    <div
                      key={game.game_id}
                      className="flex items-center justify-between rounded-2xl border border-[color:rgba(var(--color-app-foreground-rgb),0.12)] bg-[color:rgba(var(--color-app-foreground-rgb),0.04)] px-4 py-3 text-sm text-[color:var(--color-app-foreground)]"
                    >
                      <div>
                        <p className="font-semibold">{game.matchup}</p>
                        <p className="text-xs text-[color:rgba(var(--color-app-foreground-rgb),0.6)]">{new Date(game.game_date).toLocaleDateString()}</p>
                      </div>
                      <div className="flex gap-4 text-right">
                        <span>{game.points} pts</span>
                        <span>{game.rebounds} reb</span>
                        <span>{game.assists} ast</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface)] p-6">
              <p className="text-xs uppercase tracking-[0.4em] text-[color:rgba(var(--color-app-foreground-rgb),0.55)]">Season insights</p>
              <div className="mt-4 grid gap-4">
                {profile.currentSeason.insights.map((insight) => (
                  <div key={insight.label} className="rounded-2xl border border-[color:rgba(var(--color-app-foreground-rgb),0.12)] bg-[color:rgba(var(--color-app-foreground-rgb),0.04)] px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.3em] text-[color:rgba(var(--color-app-foreground-rgb),0.6)]">{insight.label}</p>
                    <p className="mt-1 text-xl font-semibold text-[color:var(--color-app-foreground)]">{insight.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mt-20">
        <SectionHeading eyebrow="Career resume" title="Season-by-season averages" />
        <div className="overflow-x-auto rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)]">
          <table className="min-w-full divide-y divide-[color:rgba(var(--color-app-foreground-rgb),0.08)] bg-[color:var(--color-app-surface)] text-xs text-[color:var(--color-app-foreground)] sm:text-sm">
            <thead className="text-left text-[0.65rem] uppercase tracking-[0.35em] text-[color:rgba(var(--color-app-foreground-rgb),0.5)] sm:text-[0.7rem]">
              <tr>
                <th className="px-4 py-3">Season</th>
                <th className="px-4 py-3">Team</th>
                <th className="px-4 py-3">MPG</th>
                <th className="px-4 py-3">PPG</th>
                <th className="px-4 py-3">RPG</th>
                <th className="px-4 py-3">APG</th>
                <th className="px-4 py-3">SPG</th>
                <th className="px-4 py-3">BPG</th>
                <th className="px-4 py-3">FG%</th>
                <th className="px-4 py-3">3P%</th>
                <th className="px-4 py-3">FT%</th>
                {showTrueShooting ? <th className="px-4 py-3">TS%</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:rgba(var(--color-app-foreground-rgb),0.08)] text-[color:var(--color-app-foreground)]">
              {profile.careerSeasons.map((season) => (
                <tr key={`avg-${season.season_id}-${season.team_abbreviation ?? "tot"}`} className="group">
                  <td className="px-4 py-2 font-semibold transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                    {renderSeasonLabel(season.season_id)}
                  </td>
                  <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                    {season.team_abbreviation ?? "—"}
                  </td>
                  <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                    {formatPerGame(season.minutes, season.games_played)}
                  </td>
                  <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                    {formatPerGame(season.points, season.games_played)}
                  </td>
                  <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                    {formatPerGame(season.rebounds, season.games_played)}
                  </td>
                  <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                    {formatPerGame(season.assists, season.games_played)}
                  </td>
                  <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                    {formatPerGame(season.steals, season.games_played)}
                  </td>
                  <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                    {formatPerGame(season.blocks, season.games_played)}
                  </td>
                  <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                    {formatPercentage(season.field_goal_pct)}
                  </td>
                  <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                    {formatPercentage(season.three_point_pct)}
                  </td>
                  <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                    {formatPercentage(season.free_throw_pct)}
                  </td>
                  {showTrueShooting ? (
                    <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {formatPercentage(season.true_shooting_pct)}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-12">
        <SectionHeading eyebrow="Career resume" title="Season-by-season totals" />
        <div className="overflow-x-auto rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)]">
          <table className="min-w-full divide-y divide-[color:rgba(var(--color-app-foreground-rgb),0.08)] bg-[color:var(--color-app-surface)] text-xs text-[color:var(--color-app-foreground)] sm:text-sm">
            <thead className="text-left text-[0.65rem] uppercase tracking-[0.3em] text-[color:rgba(var(--color-app-foreground-rgb),0.5)] sm:text-[0.7rem]">
              <tr>
                <th className="pl-3 pr-0.5 py-2">Season</th>
                <th className="pl-0 pr-1 py-2">Team</th>
                <th className="px-3 py-2">GP</th>
                <th className="px-3 py-2">MIN</th>
                <th className="px-3 py-2">PTS</th>
                <th className="px-3 py-2">REB</th>
                <th className="px-3 py-2">AST</th>
                <th className="px-3 py-2">STL</th>
                <th className="px-3 py-2">BLK</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:rgba(var(--color-app-foreground-rgb),0.08)]">
              {profile.careerSeasons.map((season) => (
                <tr key={`tot-${season.season_id}-${season.team_abbreviation ?? "tot"}`} className="group">
                  <td className="pl-3 pr-0.5 py-1.5 font-semibold transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                    {renderSeasonLabel(season.season_id)}
                  </td>
                  <td className="pl-0 pr-1 py-1.5 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                    {season.team_abbreviation ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                    {season.games_played}
                  </td>
                  <td className="px-3 py-1.5 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                    {formatInteger(season.minutes)}
                  </td>
                  <td className="px-3 py-1.5 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                    {formatInteger(season.points)}
                  </td>
                  <td className="px-3 py-1.5 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                    {formatInteger(season.rebounds)}
                  </td>
                  <td className="px-3 py-1.5 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                    {formatInteger(season.assists)}
                  </td>
                  <td className="px-3 py-1.5 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                    {formatInteger(season.steals)}
                  </td>
                  <td className="px-3 py-1.5 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                    {formatInteger(season.blocks)}
                  </td>
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
      <p className="text-xs uppercase tracking-[0.35em] text-[color:rgba(var(--color-app-primary-rgb),0.65)]">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold text-[color:var(--color-app-foreground)]">{title}</h2>
    </div>
    {rightSlot ? <div className="flex-shrink-0">{rightSlot}</div> : null}
  </div>
);

const StatCard = ({ label, value, suffix }: { label: string; value: number; suffix: string }) => (
  <article className="rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface)] p-5 shadow-lg shadow-[rgba(10,31,68,0.1)]">
    <p className="text-xs uppercase tracking-[0.3em] text-[color:rgba(var(--color-app-foreground-rgb),0.55)]">{label}</p>
    <p className="mt-3 text-3xl font-semibold text-[color:var(--color-app-foreground)]">
      {value.toFixed(1)}
      <span className="ml-1 text-sm text-[color:var(--color-app-foreground-muted)]">{suffix}</span>
    </p>
  </article>
);

const InfoPill = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl border border-[color:var(--color-app-border)] bg-[color:rgba(var(--color-app-foreground-rgb),0.04)] px-4 py-3 text-sm text-[color:var(--color-app-foreground-muted)]">
    <p className="text-xs uppercase tracking-[0.3em] text-[color:rgba(var(--color-app-foreground-rgb),0.55)]">{label}</p>
    <p className="mt-1 text-base font-semibold text-[color:var(--color-app-foreground)]">{value}</p>
  </div>
);
