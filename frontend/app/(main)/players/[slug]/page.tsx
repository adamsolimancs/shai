import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { DEFAULT_SEASON, nbaFetch } from "@/lib/nbaApi";
import { containsBannedTerm } from "@/lib/utils";
import AwardsAccordion from "@/components/AwardsAccordion";
import AwardSummaryChips from "@/components/AwardSummaryChips";
import PlayerCareerResume from "@/components/PlayerCareerResume";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

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

type LeagueStandingRow = {
  team_id: number;
  team_name?: string | null;
  team_city?: string | null;
  team_abbreviation?: string | null;
  wins: number;
  losses: number;
  win_pct: number;
};

type RecordLike = {
  wins: number;
  losses: number;
  win_pct: number;
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

type PlayerBio = {
  height?: string | null;
  weight?: number | null;
  draft_year?: number | null;
  draft_pick?: string | null;
  college?: string | null;
  country?: string | null;
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
  careerSeasonsPlayoffs: PlayerCareerStatsRow[];
  recentGames: PlayerGameLog[];
  awards: PlayerAward[];
  rings: number;
  ringSeasons: string[];
  bio?: PlayerBio | null;
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

const awardText = (award: PlayerAward): string =>
  [award.description, award.award_type, award.subtype1, award.subtype2, award.subtype3]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const isAllStarAward = (text: string) => /all[-\s]?star/.test(text);
const isAllNbaAward = (text: string) => /all[-\s]?nba/.test(text);
const isAllDefenseAward = (text: string) => /all[-\s]?(defense|defensive)/.test(text);
const isClutchAward = (text: string) => text.includes("clutch") || text.includes("cpoy");
const isFinalsMvpAward = (text: string) =>
  text.includes("finals most valuable player") || text.match(/\bfinals mvp\b/);
const isCupMvpAward = (text: string) =>
  text.includes("cup most valuable player") ||
  text.includes("nba cup mvp") ||
  text.includes("in-season tournament mvp") ||
  text.includes("tournament mvp");
const isRookieOfYearAward = (text: string) =>
  text.includes("rookie of the year") || text.match(/\broy\b/);
const isDefensivePlayerOfYearAward = (text: string) =>
  text.includes("defensive player of the year") || text.match(/\bdpoy\b/);
const isOlympicGoldMedal = (text: string) => text.includes("olympic gold medal");
const isOlympicSilverMedal = (text: string) => text.includes("olympic silver medal");
const isOlympicBronzeMedal = (text: string) => text.includes("olympic bronze medal");
const MVP_EXCLUDE = /finals|all[-\s]?star|cup|tournament|sporting news|conference|playoffs|summer league|g league|d-league/;
const isRegularSeasonMvp = (text: string) => {
  if (!text.includes("most valuable player") && !text.match(/\bmvp\b/)) {
    return false;
  }
  return !MVP_EXCLUDE.test(text);
};

const awardRank = (award: PlayerAward): number => {
  const text = awardText(award);
  if (isRegularSeasonMvp(text)) return 0;
  if (isFinalsMvpAward(text)) return 1;
  if (isCupMvpAward(text)) return 2;
  if (isDefensivePlayerOfYearAward(text)) return 3;
  if (isRookieOfYearAward(text)) return 4;
  if (isAllNbaAward(text)) return 5;
  if (isAllDefenseAward(text)) return 6;
  if (isAllStarAward(text)) return 7;
  if (isOlympicGoldMedal(text)) return 8;
  if (isOlympicSilverMedal(text)) return 9;
  if (isOlympicBronzeMedal(text)) return 10;
  if (isClutchAward(text)) return 11;
  return 12;
};

const seasonSortKey = (season: string | undefined): number => {
  if (!season) return 0;
  const trimmed = season.trim();
  const startYear = Number.parseInt(trimmed.slice(0, 4), 10);
  if (Number.isNaN(startYear)) return 0;
  if (!trimmed.includes("-")) return startYear;
  const suffix = trimmed.slice(trimmed.indexOf("-") + 1);
  const endSuffix = Number.parseInt(suffix, 10);
  if (Number.isNaN(endSuffix)) return startYear;
  const centuryBase = Math.floor(startYear / 100) * 100;
  let endYear = centuryBase + endSuffix;
  if (endYear < startYear) {
    endYear += 100;
  }
  return endYear;
};

const sortSeasons = (seasons: Iterable<string>) =>
  [...seasons].sort((a, b) => seasonSortKey(b) - seasonSortKey(a));

const sortAwards = (awards: PlayerAward[]) =>
  [...awards].sort((a, b) => {
    const seasonDelta = seasonSortKey(b.season) - seasonSortKey(a.season);
    if (seasonDelta !== 0) return seasonDelta;
    const rankDelta = awardRank(a) - awardRank(b);
    if (rankDelta !== 0) return rankDelta;
    return (a.description ?? "").localeCompare(b.description ?? "");
  });

const normalizeAwardSummary = (awards: PlayerAward[], ringCount: number, ringSeasons?: string[]) => {
  const summary = {
    allStar: new Set<string>(),
    allNba: new Set<string>(),
    allDefense: new Set<string>(),
    mvp: new Set<string>(),
    finalsMvp: new Set<string>(),
    cupMvp: new Set<string>(),
    dpoy: new Set<string>(),
    roy: new Set<string>(),
    olympicGold: new Set<string>(),
    olympicSilver: new Set<string>(),
    olympicBronze: new Set<string>(),
    cpoy: new Set<string>(),
  };

  awards.forEach((award) => {
    if (!award.season) return;
    const text = awardText(award);
    if (!text) return;
    if (isAllStarAward(text)) summary.allStar.add(award.season);
    if (isAllNbaAward(text)) summary.allNba.add(award.season);
    if (isAllDefenseAward(text)) summary.allDefense.add(award.season);
    if (isClutchAward(text)) summary.cpoy.add(award.season);
    if (isRegularSeasonMvp(text)) summary.mvp.add(award.season);
    if (isFinalsMvpAward(text)) summary.finalsMvp.add(award.season);
    if (isCupMvpAward(text)) summary.cupMvp.add(award.season);
    if (isDefensivePlayerOfYearAward(text)) summary.dpoy.add(award.season);
    if (isRookieOfYearAward(text)) summary.roy.add(award.season);
    if (isOlympicGoldMedal(text)) summary.olympicGold.add(award.season);
    if (isOlympicSilverMedal(text)) summary.olympicSilver.add(award.season);
    if (isOlympicBronzeMedal(text)) summary.olympicBronze.add(award.season);
  });

  const ordered = [
    { label: "MVP", count: summary.mvp.size, seasons: sortSeasons(summary.mvp) },
    { label: "Finals MVP", count: summary.finalsMvp.size, seasons: sortSeasons(summary.finalsMvp) },
    { label: "Cup MVP", count: summary.cupMvp.size, seasons: sortSeasons(summary.cupMvp) },
    { label: "Rings", count: ringCount, seasons: ringSeasons?.length ? sortSeasons(new Set(ringSeasons)) : undefined },
    { label: "DPOY", count: summary.dpoy.size, seasons: sortSeasons(summary.dpoy) },
    { label: "ROTY", count: summary.roy.size, seasons: sortSeasons(summary.roy) },
    { label: "All-NBA", count: summary.allNba.size, seasons: sortSeasons(summary.allNba) },
    { label: "All-Defense", count: summary.allDefense.size, seasons: sortSeasons(summary.allDefense) },
    { label: "All-Star", count: summary.allStar.size, seasons: sortSeasons(summary.allStar) },
    { label: "Olympic Gold", count: summary.olympicGold.size, seasons: sortSeasons(summary.olympicGold) },
    { label: "Olympic Silver", count: summary.olympicSilver.size, seasons: sortSeasons(summary.olympicSilver) },
    { label: "Olympic Bronze", count: summary.olympicBronze.size, seasons: sortSeasons(summary.olympicBronze) },
    { label: "CPOY", count: summary.cpoy.size, seasons: sortSeasons(summary.cpoy) },
  ];
  return ordered.filter((item) => item.count > 0);
};

const filterAwards = (awards: PlayerAward[]) =>
  awards.filter((award) => {
    const haystack = `${award.description ?? ""} ${award.award_type ?? ""}`.toLowerCase();
    return !haystack.match(/player of the (week|month)|potw|potm/);
  });

const extractAllStarSeasons = (awards: PlayerAward[]) => {
  const set = new Set<string>();
  awards.forEach((award) => {
    if (!award.season) return;
    const text = awardText(award);
    if (isAllStarAward(text)) {
      set.add(award.season);
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

function estimateCareerAccolades(rows?: PlayerCareerStatsRow[]): {
  allStarSeasons: number;
  championships: number;
  championshipSeasons: string[];
} {
  if (!rows?.length) {
    return { allStarSeasons: 0, championships: 0, championshipSeasons: [] };
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

  return {
    allStarSeasons,
    championships: championSeasons.size,
    championshipSeasons: [...championSeasons],
  };
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

function formatRecord(stats?: RecordLike): string | undefined {
  if (!stats) return undefined;
  return `${stats.wins}-${stats.losses} (${Math.round(stats.win_pct * 100)}% W)`;
}

function formatStandingTeamName(row?: LeagueStandingRow): string | undefined {
  if (!row) return undefined;
  const full = `${row.team_city ?? ""} ${row.team_name ?? ""}`.trim();
  return full || row.team_name || row.team_abbreviation || undefined;
}

function latestTeamAbbreviation(gamelog: PlayerGameLog[]): string | null {
  let latest = -Infinity;
  let latestTeam: string | null = null;
  for (const game of gamelog) {
    const time = new Date(game.game_date).getTime();
    if (Number.isNaN(time) || time <= latest) {
      continue;
    }
    latest = time;
    latestTeam = game.team_abbreviation || null;
  }
  return latestTeam;
}

function resolveCurrentTeamRow(
  rows: PlayerCareerStatsRow[],
  gamelog: PlayerGameLog[],
  seasonId: string,
): PlayerCareerStatsRow | undefined {
  const latestTeam = latestTeamAbbreviation(gamelog);
  if (latestTeam) {
    const match = rows.find(
      (row) => row.season_id === seasonId && row.team_abbreviation === latestTeam,
    );
    if (match) {
      return match;
    }
  }
  return (
    rows.find((row) => row.season_id === seasonId && row.team_abbreviation !== "TOT") ||
    rows.find((row) => row.season_id === seasonId)
  );
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

const noStore = { cache: "no-store" as const };

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
    const resolution = await nbaFetch<ResolveResult>(
      `/v1/resolve?player=${encodeURIComponent(query)}`,
      noStore,
    );
    const playerId = resolution.player?.id;
    if (!playerId) {
      return null;
    }
    const [career, playoffsCareer, gamelog, awards] = await Promise.all([
      nbaFetch<PlayerCareerStatsRow[]>(
        `/v1/players/${playerId}/career?season_type=Regular%20Season`,
        noStore,
      ),
      nbaFetch<PlayerCareerStatsRow[]>(
        `/v1/players/${playerId}/career?season_type=Playoffs`,
        noStore,
      ),
      nbaFetch<PlayerGameLog[]>(
        `/v1/players/${playerId}/gamelog?season=${DEFAULT_SEASON}`,
        noStore,
      ),
      (async () => {
        try {
          return await nbaFetch<PlayerAward[]>(`/v1/players/${playerId}/awards`, noStore);
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
    const isActive = seasonRow?.season_id === DEFAULT_SEASON;
    const currentTeamRow = isActive
      ? resolveCurrentTeamRow(career, gamelog, DEFAULT_SEASON)
      : seasonRow;
    const teamId = currentTeamRow?.team_id ?? seasonRow?.team_id;
    const currentTeamAbbr =
      currentTeamRow?.team_abbreviation ??
      latestTeamAbbreviation(gamelog) ??
      seasonRow?.team_abbreviation ??
      null;
    let standingsRow: LeagueStandingRow | undefined;
    if (isActive && teamId != null && teamId > 0) {
      try {
        const standings = await nbaFetch<LeagueStandingRow[]>(
          `/v1/league_standings?season=${DEFAULT_SEASON}&league_id=00&season_type=Regular%20Season`,
          noStore,
        );
        standingsRow = standings.find((row) => row.team_id === teamId);
        if (!standingsRow && currentTeamAbbr) {
          standingsRow = standings.find(
            (row) => row.team_abbreviation?.toLowerCase() === currentTeamAbbr.toLowerCase(),
          );
        }
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.error("Failed to load league standings", error);
        }
      }
    }
    let teamStats: TeamStatsRow[] = [];
    if ((!isActive || !standingsRow) && teamId != null && teamId > 0) {
      try {
        teamStats = await nbaFetch<TeamStatsRow[]>(
          `/v1/teams/${teamId}/stats?season=${statsSeasonId}&measure=Base&per_mode=PerGame`,
          noStore,
        );
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.error("Failed to load team stats", error);
        }
        teamStats = [];
      }
    }

    let bio: PlayerBio | null = null;
    try {
      bio = await nbaFetch<PlayerBio | null>(
        `/v1/players/${playerId}/bio?season=${statsSeasonId}`,
        noStore,
      );
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("Failed to load player bio", error);
      }
      bio = null;
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

    const teamRecord = isActive ? formatRecord(standingsRow ?? teamStats[0]) : undefined;
    const rating = deriveRating(stats, career);
    const scoutingReport = stats
      ? isActive
        ? `${resolution.player?.name ?? query} is pacing ${stats.pts.toFixed(1)} / ${stats.reb.toFixed(1)} / ${stats.ast.toFixed(1)} this season.`
        : `${resolution.player?.name ?? query} averaged ${stats.pts.toFixed(1)} / ${stats.reb.toFixed(1)} / ${stats.ast.toFixed(1)} in ${seasonRow?.season_id ?? "his last season"}.`
      : `${resolution.player?.name ?? query} career overview.`;

    const collapsedCareer = collapseCareerRows(career);
    const collapsedPlayoffs = collapseCareerRows(playoffsCareer);
    const experienceSeasons = collapsedCareer.length;
    const { championships, championshipSeasons } = estimateCareerAccolades(career);

    return {
      slug,
      playerId,
      name: resolution.player?.name ?? query,
      team: formatStandingTeamName(standingsRow) ?? teamStats[0]?.team_name ?? currentTeamRow?.team_abbreviation ?? resolution.player?.abbreviation ?? "Free Agent",
      teamAbbreviation: standingsRow?.team_abbreviation ?? currentTeamRow?.team_abbreviation ?? teamStats[0]?.team_abbreviation ?? null,
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
            ...(isActive ? [{ label: "Wins / Losses", value: teamRecord ?? "—" }] : []),
          ],
        }
        : undefined,
      careerSeasons: collapsedCareer,
      careerSeasonsPlayoffs: collapsedPlayoffs,
      recentGames: gamelog.slice(0, 5),
      awards: sortAwards(filterAwards(awards)),
      rings: championships,
      ringSeasons: sortSeasons(championshipSeasons),
      bio,
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
    return players.slice(0, 12).map((player) => ({ slug: String(player.id) }));
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
        title: "Player not found",
        description: "We could not locate that player in the NBA data service.",
      };
    }
    return {
      title: profile.name,
      description: `${profile.name} overview powered by nba_api data.`,
    };
  } catch {
    return {
      title: "Player profile",
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

type PlayerPageParams = {
  params: Promise<{ slug: string }> | { slug: string };
};

export default async function PlayerPage({ params }: PlayerPageParams) {
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
  if (resolvedParams.slug !== String(profile.playerId)) {
    redirect(`/players/${profile.playerId}`);
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
  const awardSummary = normalizeAwardSummary(profile.awards, profile.rings, profile.ringSeasons);
  const allStarSeasons = extractAllStarSeasons(profile.awards);
  const parseHeightInches = (height?: string | null): number | null => {
    if (!height) return null;
    const trimmed = height.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^(\d+)\s*[-']\s*(\d+)/);
    if (match) {
      const feet = Number.parseInt(match[1], 10);
      const inches = Number.parseInt(match[2], 10);
      if (!Number.isNaN(feet) && !Number.isNaN(inches)) {
        return feet * 12 + inches;
      }
    }
    const asNumber = Number.parseInt(trimmed, 10);
    return Number.isNaN(asNumber) ? null : asNumber;
  };
  const formatHeight = (height?: string | null): string | null => {
    const totalInches = parseHeightInches(height);
    if (!totalInches) return null;
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    const cm = Math.round(totalInches * 2.54);
    return `${feet}'${inches}\" (${cm} cm)`;
  };
  const formatWeight = (weight?: number | null): string | null => {
    if (!weight) return null;
    const kg = Math.round(weight * 0.453592);
    return `${weight} lbs (${kg} kg)`;
  };
  const draftDetails = [profile.bio?.draft_pick ?? null, profile.bio?.draft_year ? `${profile.bio.draft_year}` : null]
    .filter(Boolean)
    .join(", ");
  const agePill = { label: "Age", value: profile.age ? `${profile.age}` : "—" };
  const experiencePill = { label: "Experience", value: profile.experience };
  const heightPill = { label: "Height", value: formatHeight(profile.bio?.height) };
  const weightPill = { label: "Weight", value: formatWeight(profile.bio?.weight ?? null) };
  const draftPill = { label: "Draft", value: draftDetails || null };
  const collegePill = { label: "College", value: profile.bio?.college ?? null };
  const countryPill = { label: "Country", value: profile.bio?.country ?? null };
  const teamRecordPill = isActive ? { label: "Team record", value: profile.currentSeason?.teamRecord ?? "—" } : null;
  const infoRows: Array<Array<{ label: string; value: string | null } | null>> = [
    [agePill, experiencePill],
    [heightPill, weightPill],
    [collegePill, countryPill],
    [draftPill, teamRecordPill],
  ];

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
            <dl className="grid gap-2 rounded-2xl border border-[color:var(--color-app-border)] bg-[color:rgba(var(--color-app-foreground-rgb),0.04)] p-3 text-sm text-[color:var(--color-app-foreground)]">
              {infoRows.map((row, rowIndex) => {
                const rowItems = row.filter(
                  (item): item is { label: string; value: string } => Boolean(item?.value),
                );
                if (rowItems.length === 0) {
                  return null;
                }
                return (
                  <div key={`row-${rowIndex}`} className="grid gap-2 sm:grid-cols-2">
                    {rowItems.map((pill) => (
                      <div
                        key={`${pill.label}-${pill.value}`}
                        className={`flex items-baseline justify-between gap-3 border-b border-[color:rgba(var(--color-app-foreground-rgb),0.08)] py-2 sm:border-b-0 sm:border-r sm:pr-4 sm:last:border-r-0 ${
                          rowItems.length === 1 ? "sm:col-span-2" : ""
                        }`}
                      >
                        <dt className="text-xs uppercase tracking-[0.3em] text-[color:rgba(var(--color-app-foreground-rgb),0.55)]">
                          {pill.label}
                        </dt>
                        <dd className="text-right font-semibold text-[color:var(--color-app-foreground)]">
                          {pill.value}
                        </dd>
                      </div>
                    ))}
                  </div>
                );
              })}
            </dl>
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
              {awardSummary.length > 0 ? <AwardSummaryChips items={awardSummary} /> : null}
              {profile.awards.length === 0 ? (
                <p className="mt-2 text-sm text-[color:var(--color-app-foreground-muted)]">No official league awards recorded.</p>
              ) : (
                <Suspense fallback={<AwardsAccordionSkeleton />}>
                  <AwardsAccordion awards={profile.awards} />
                </Suspense>
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

      <Suspense fallback={<CareerResumeSkeleton />}>
        <PlayerCareerResume
          regularSeasons={profile.careerSeasons}
          playoffSeasons={profile.careerSeasonsPlayoffs}
          allStarSeasons={[...allStarSeasons]}
        />
      </Suspense>
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

const AwardsAccordionSkeleton = () => (
  <div className="mt-3 space-y-2" aria-hidden="true">
    <div className="skeleton-block h-4 w-2/3 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.15)]" />
    <div className="skeleton-block h-4 w-4/5 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.12)]" />
    <div className="skeleton-block h-4 w-1/2 rounded-full bg-[color:rgba(var(--color-app-foreground-rgb),0.1)]" />
  </div>
);

const CareerResumeSkeleton = () => (
  <div className="mt-20 space-y-10" aria-hidden="true">
    <div className="space-y-3">
      <div className="skeleton-block h-3 w-32 rounded-full bg-[color:rgba(var(--color-app-primary-rgb),0.3)]" />
      <div className="skeleton-block h-7 w-48 rounded-2xl bg-[color:rgba(var(--color-app-foreground-rgb),0.12)]" />
    </div>
    <div className="skeleton-block h-64 rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)]" />
    <div className="space-y-3">
      <div className="skeleton-block h-3 w-28 rounded-full bg-[color:rgba(var(--color-app-primary-rgb),0.3)]" />
      <div className="skeleton-block h-7 w-44 rounded-2xl bg-[color:rgba(var(--color-app-foreground-rgb),0.12)]" />
    </div>
    <div className="skeleton-block h-64 rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)]" />
  </div>
);
