#!/usr/bin/env node
"use strict";

if (typeof fetch !== "function") {
  console.error("This worker requires Node.js 18+ (global fetch).");
  process.exit(1);
}

const { cache } = require("./cache");

function normalizeBaseUrl(value) {
  if (!value) return value;
  const trimmed = value
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(String(value).toLowerCase());
}

function toText(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function seasonToYear(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^2\d{4}$/.test(text)) {
    return Number(text.slice(1));
  }
  const match = text.match(/^(\d{4})/);
  if (match) {
    return Number(match[1]);
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function normalizeBooleanText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(text)) return "true";
  if (["0", "false", "no", "n", "off"].includes(text)) return "false";
  return text;
}

function toPlayerId(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

const CONFIG = {
  workerMode: process.env.WORKER_MODE || "cron",
  apiBaseUrl: normalizeBaseUrl(process.env.NBA_API_BASE_URL || "http://localhost:8080"),
  apiKey: process.env.NBA_API_KEY,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  supabaseSchema: process.env.SUPABASE_SCHEMA || "public",
  seasonOverride: process.env.NBA_SEASON,
  historicSeasons: process.env.HISTORIC_SEASONS || "",
  historicSeasonsBack: Number(process.env.HISTORIC_SEASONS_BACK || 0),
  playersHistoricMode: process.env.PLAYERS_HISTORIC_MODE || "once",
  playersHistoricSeasonsBack: Number(
    process.env.PLAYERS_HISTORIC_SEASONS_BACK ||
      process.env.HISTORIC_SEASONS_BACK ||
      0
  ),
  timeZone: process.env.NBA_TIME_ZONE || "America/New_York",
  cronMinIntervalMs: Number(process.env.CRON_MIN_INTERVAL_MS || 60 * 1000),
  cronWindowStartHour: toNumber(process.env.CRON_WINDOW_START_HOUR) ?? 15,
  cronWindowEndHour: toNumber(process.env.CRON_WINDOW_END_HOUR) ?? 0,
  cronMaxRunsPerDay: toNumber(process.env.CRON_MAX_RUNS_PER_DAY) ?? 0,
  cronMaxRuntimeMs: toNumber(process.env.CRON_MAX_RUNTIME_MS) ?? 60 * 60 * 1000,
  cronInWindowMinIntervalMs: Number(
    process.env.CRON_IN_WINDOW_MIN_INTERVAL_MS || 15 * 60 * 1000
  ),
  cronInWindowMaxIntervalMs: Number(
    process.env.CRON_IN_WINDOW_MAX_INTERVAL_MS || 30 * 60 * 1000
  ),
  cronOffWindowIntervalMs: Number(
    process.env.CRON_OFF_WINDOW_INTERVAL_MS || 3 * 60 * 60 * 1000
  ),
  apiMinIntervalMs: Number(process.env.API_MIN_INTERVAL_MS || 250),
  apiRetryMax: Number(process.env.API_RETRY_MAX || 4),
  apiRetryBaseDelayMs: Number(process.env.API_RETRY_BASE_DELAY_MS || 750),
  apiCircuitBreakerMaxFailures: Number(process.env.API_CIRCUIT_BREAKER_MAX_FAILURES || 5),
  apiCircuitBreakerCooldownMs: Number(
    process.env.API_CIRCUIT_BREAKER_COOLDOWN_MS || 5 * 60 * 1000
  ),
  gamesIntervalMs: Number(process.env.GAMES_INTERVAL_MS || 6 * 60 * 60 * 1000),
  livePollIntervalMs: Number(process.env.LIVE_GAMES_INTERVAL_MS || 5000),
  scoreboardIntervalMs: Number(process.env.SCOREBOARD_INTERVAL_MS || 10000),
  teamsIntervalMs: Number(process.env.TEAMS_INTERVAL_MS || 6 * 60 * 60 * 1000),
  playersIntervalMs: Number(process.env.PLAYERS_INTERVAL_MS || 6 * 60 * 60 * 1000),
  standingsIntervalMs: Number(process.env.STANDINGS_INTERVAL_MS || 15 * 60 * 1000),
  playerStatsIntervalMs: Number(process.env.PLAYER_STATS_INTERVAL_MS || 6 * 60 * 60 * 1000),
  teamStatsIntervalMs: Number(process.env.TEAM_STATS_INTERVAL_MS || 60 * 60 * 1000),
  teamDetailsIntervalMs: Number(process.env.TEAM_DETAILS_INTERVAL_MS || 24 * 60 * 60 * 1000),
  playerAwardsIntervalMs: Number(process.env.PLAYER_AWARDS_INTERVAL_MS || 24 * 60 * 60 * 1000),
  playerAwardsActiveOnly: parseBoolean(process.env.PLAYER_AWARDS_ACTIVE_ONLY, true),
  boxscoreBackfillIntervalMs: Number(
    process.env.BOXSCORE_BACKFILL_INTERVAL_MS || 60 * 60 * 1000
  ),
  boxscoreLookbackDays: Number(process.env.BOXSCORE_LOOKBACK_DAYS || 7),
  statusRefreshMs: Number(process.env.STATUS_REFRESH_MS || 60 * 1000),
  boxscoreConcurrency: Number(process.env.BOXSCORE_CONCURRENCY || 3),
  upsertChunkSize: Number(process.env.UPSERT_CHUNK_SIZE || 200),
  cacheKeyPrefix: process.env.CACHE_KEY_PREFIX || "nba:serve",
  cacheTtlScoreboardLiveSec: Number(process.env.CACHE_TTL_SCOREBOARD_LIVE_SEC || 5),
  cacheTtlScoreboardFinalSec: Number(process.env.CACHE_TTL_SCOREBOARD_FINAL_SEC || 60 * 60),
  cacheTtlBoxscoreLiveSec: Number(process.env.CACHE_TTL_BOXSCORE_LIVE_SEC || 5),
  cacheTtlBoxscoreFinalSec: Number(
    process.env.CACHE_TTL_BOXSCORE_FINAL_SEC || 60 * 60 * 12
  ),
  cacheTtlStandingsSec: Number(process.env.CACHE_TTL_STANDINGS_SEC || 60 * 15),
  cacheTtlTeamsSec: Number(process.env.CACHE_TTL_TEAMS_SEC || 60 * 60 * 24),
};

function validateConfig() {
  if (!CONFIG.apiKey) {
    throw new Error("NBA_API_KEY is required.");
  }
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
}

const NBA_STATS_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.nba.com",
  Referer: "https://www.nba.com/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/120.0 Safari/537.36",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
};

const activeGameIds = new Set();
const statusCache = new Map();
let cachedSeason = null;
let cachedSeasonAt = 0;
let cachedSupportedSeasons = null;
let cachedSupportedSeasonsAt = 0;
let requestQueue = Promise.resolve();
let statsRequestQueue = Promise.resolve();
let lastApiRequestAt = 0;
let lastStatsRequestAt = 0;
let apiCircuitOpenUntil = 0;
let apiCircuitFailures = 0;
const cacheStats = {
  writes: 0,
  failures: 0,
  lastLogAt: 0,
};
let cronBudget = null;

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection", reason);
});

function log(message, extra) {
  const stamp = new Date().toISOString();
  if (extra !== undefined) {
    console.log(`[${stamp}] ${message}`, extra);
  } else {
    console.log(`[${stamp}] ${message}`);
  }
}

function logUpsert(table, count, extra) {
  log(`Upserted ${count} rows into table '${table}'`, extra);
}

function initCronBudget() {
  const maxRuntimeMs = toNumber(CONFIG.cronMaxRuntimeMs);
  if (!Number.isFinite(maxRuntimeMs) || maxRuntimeMs <= 0) {
    cronBudget = null;
    return;
  }
  const startedAt = Date.now();
  cronBudget = {
    startedAt,
    deadline: startedAt + maxRuntimeMs,
    maxRuntimeMs,
    exceeded: false,
  };
}

function clearCronBudget() {
  cronBudget = null;
}

function isCronBudgetActive() {
  return Boolean(cronBudget && Number.isFinite(cronBudget.deadline));
}

function cronRemainingMs() {
  if (!isCronBudgetActive()) return null;
  return Math.max(0, cronBudget.deadline - Date.now());
}

function throwIfCronBudgetExceeded(label) {
  if (!isCronBudgetActive()) return;
  if (Date.now() <= cronBudget.deadline) return;
  if (!cronBudget.exceeded) {
    cronBudget.exceeded = true;
    log("Cron runtime budget exceeded; halting work", {
      label,
      max_runtime_ms: cronBudget.maxRuntimeMs,
    });
  }
  throw new CronBudgetError("Cron runtime budget exceeded");
}

function sleep(ms) {
  if (!isCronBudgetActive()) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  const remaining = cronRemainingMs();
  if (remaining !== null && remaining <= 0) {
    return Promise.reject(new CronBudgetError("Cron runtime budget exceeded"));
  }
  const waitMs = remaining !== null ? Math.min(ms, remaining) : ms;
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (remaining !== null && waitMs < ms) {
        reject(new CronBudgetError("Cron runtime budget exceeded"));
        return;
      }
      if (remaining !== null && cronRemainingMs() <= 0) {
        reject(new CronBudgetError("Cron runtime budget exceeded"));
        return;
      }
      resolve();
    }, waitMs);
  });
}

function cacheKey(...parts) {
  const prefix = CONFIG.cacheKeyPrefix.replace(/:+$/, "");
  const joined = parts.map((part) => String(part).replace(/^:+|:+$/g, "")).join(":");
  return joined ? `${prefix}:${joined}` : prefix;
}

const CacheKeys = {
  scoreboard: (date) => cacheKey("scoreboard", date),
  boxscore: (gameId) => cacheKey("boxscore", gameId),
  standings: (season, leagueId = "00", seasonType = "Regular Season") =>
    cacheKey("standings", season, leagueId, seasonType),
  teams: (season) => cacheKey("teams", season),
};

function recordCacheWrite(ok) {
  if (ok) {
    cacheStats.writes += 1;
  } else {
    cacheStats.failures += 1;
  }
  const now = Date.now();
  if (now - cacheStats.lastLogAt > 60 * 1000) {
    cacheStats.lastLogAt = now;
    log("Cache write stats", {
      writes: cacheStats.writes,
      failures: cacheStats.failures,
    });
  }
}

async function writeCache(key, payload, ttlSeconds) {
  if (!cache) return;
  try {
    await cache.set(key, payload, { ex: ttlSeconds });
    recordCacheWrite(true);
  } catch (error) {
    recordCacheWrite(false);
    log("Redis cache write failed", { key, error: String(error) });
  }
}

class CircuitOpenError extends Error {
  constructor(message) {
    super(message);
    this.name = "CircuitOpenError";
  }
}

class CronBudgetError extends Error {
  constructor(message) {
    super(message);
    this.name = "CronBudgetError";
  }
}

function isCronBudgetError(error) {
  return error instanceof CronBudgetError || error?.name === "CronBudgetError";
}

function isCircuitOpen() {
  return Date.now() < apiCircuitOpenUntil;
}

function recordApiSuccess() {
  apiCircuitFailures = 0;
}

function recordApiFailure() {
  apiCircuitFailures += 1;
  if (apiCircuitFailures >= CONFIG.apiCircuitBreakerMaxFailures) {
    apiCircuitFailures = 0;
    apiCircuitOpenUntil = Date.now() + CONFIG.apiCircuitBreakerCooldownMs;
    log("API circuit opened; cooling down", {
      cooldown_ms: CONFIG.apiCircuitBreakerCooldownMs,
    });
  }
}

function formatDateInTZ(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function getHourInTZ(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(lookup.hour);
  return Number.isFinite(hour) ? hour : null;
}

function getSeasonForDate(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(lookup.year);
  const month = Number(lookup.month);
  const startYear = month >= 10 ? year : year - 1;
  const suffix = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${suffix}`;
}

function normalizeHour(value) {
  if (!Number.isFinite(value)) return null;
  const hour = Math.trunc(value);
  const normalized = ((hour % 24) + 24) % 24;
  return normalized;
}

function isHourInWindow(hour, startHour, endHour) {
  if (!Number.isFinite(hour)) return true;
  if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) return true;
  if (startHour === endHour) return true;
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  return hour >= startHour || hour < endHour;
}

function normalizeConflictValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }
  return value;
}

function isFinalStatus(status) {
  return Boolean(status && /final/i.test(status));
}

function isLiveStatus(status) {
  if (!status) return false;
  const text = String(status).toLowerCase();
  if (text.includes("final")) return false;
  if (text.includes("scheduled") || text.includes("pre")) return false;
  if (text.includes("postponed") || text.includes("cancel")) return false;
  if (text.includes("pm") || text.includes("am") || text.includes("et")) return false;
  return true;
}

function parseSeasonList(value) {
  return value
    .split(",")
    .map((season) => season.trim())
    .filter(Boolean);
}

function normalizeSeasonList(seasons) {
  return Array.from(new Set(seasons)).sort();
}

function seasonsMatch(a, b) {
  const left = normalizeSeasonList(a || []);
  const right = normalizeSeasonList(b || []);
  if (left.length !== right.length) return false;
  return left.every((season, index) => season === right[index]);
}

function mapTeamRow(team) {
  if (!team) return null;
  const teamId = team.team_id ?? team.id ?? null;
  if (teamId === null || teamId === undefined) return null;
  return {
    team_id: teamId,
    abbreviation: team.abbreviation ?? null,
    city: team.city ?? null,
    name: team.name ?? null,
    conference: team.conference ?? null,
    division: team.division ?? null,
  };
}

function mapPlayerRow(player) {
  if (!player) return null;
  const playerId = toPlayerId(player.player_id ?? player.id);
  if (!playerId) return null;
  return {
    player_id: playerId,
    full_name: player.full_name ?? null,
    current_team_id: player.current_team_id ?? player.team_id ?? null,
    is_active: normalizeBooleanText(player.is_active),
  };
}

function mapGameRow(game, season) {
  if (!game) return null;
  const gameId = game.game_id ?? null;
  if (!gameId) return null;
  return {
    game_id: gameId,
    date: toText(game.date),
    home_team_id: game.home_team_id ?? null,
    home_team_name: game.home_team_name ?? null,
    home_team_score: game.home_team_score ?? null,
    away_team_id: game.away_team_id ?? null,
    away_team_name: game.away_team_name ?? null,
    away_team_score: game.away_team_score ?? null,
    season: seasonToYear(season ?? game.season),
  };
}

function mapLeagueStandingRow(row, season) {
  if (!row) return null;
  const teamId = row.team_id ?? null;
  const resolvedSeason = season ?? row.season ?? null;
  if (teamId === null || teamId === undefined || !resolvedSeason) return null;
  return {
    season: resolvedSeason,
    team_id: teamId,
    conference: row.conference ?? null,
    conference_rank: row.conference_rank ?? null,
    division: row.division ?? null,
    division_rank: row.division_rank ?? null,
    wins: row.wins ?? null,
    losses: row.losses ?? null,
    win_pct: row.win_pct ?? null,
    games_back: row.games_back ?? null,
    division_games_back: row.division_games_back ?? null,
    record: row.record ?? null,
    home_record: row.home_record ?? null,
    road_record: row.road_record ?? null,
    last_ten: row.last_ten ?? null,
    streak: row.streak ?? null,
  };
}

function mapTeamDetailRow(detail, teamId) {
  if (!detail) detail = {};
  const resolvedTeamId = detail.team_id ?? teamId ?? null;
  if (resolvedTeamId === null || resolvedTeamId === undefined) return null;
  return {
    team_id: resolvedTeamId,
    year_founded:
      detail.year_founded === undefined || detail.year_founded === null
        ? null
        : String(detail.year_founded),
    arena: detail.arena ?? null,
    arena_capacity: detail.arena_capacity ?? null,
    owner: detail.owner ?? null,
    general_manager: detail.general_manager ?? null,
    head_coach: detail.head_coach ?? null,
    dleague_affiliation: detail.dleague_affiliation ?? null,
    championships: toText(detail.championships),
    conference_titles: toText(detail.conference_titles),
    division_titles: toText(detail.division_titles),
    hall_of_famers: toText(detail.hall_of_famers),
    retired_numbers: toText(detail.retired_numbers),
    social_sites: toText(detail.social_sites),
  };
}

function mapPlayerAwardRow(row, playerId) {
  if (!row) return null;
  const resolvedPlayerId = toPlayerId(playerId);
  if (!resolvedPlayerId || !row.season || !row.description) return null;
  return {
    player_id: resolvedPlayerId,
    season: row.season,
    description: row.description,
    subtype1: row.subtype1 ?? null,
    month: row.month ?? null,
    all_nba_team_number: row.all_nba_team_number ?? null,
  };
}

function mapPlayerSeasonStatsRow(row, season, seasonType) {
  if (!row) return null;
  const resolvedSeason = season ?? row.season ?? null;
  const resolvedPlayerId = toPlayerId(
    row.player_id ?? row.PLAYER_ID ?? row.id ?? row.PERSON_ID
  );
  const resolvedSeasonType = seasonType ?? row.season_type ?? "Regular Season";
  if (!resolvedSeason || !resolvedPlayerId || !resolvedSeasonType) return null;
  return {
    season: resolvedSeason,
    player_id: resolvedPlayerId,
    team_id: row.team_id ?? row.TEAM_ID ?? null,
    games_played: toNumber(row.games_played ?? row.GP),
    games_started: toNumber(row.games_started ?? row.GS),
    minutes_pg: toNumber(row.minutes_pg ?? row.MIN ?? row.minutes),
    points_pg: toNumber(row.points_pg ?? row.PTS ?? row.points),
    rebounds_pg: toNumber(row.rebounds_pg ?? row.REB ?? row.rebounds),
    assists_pg: toNumber(row.assists_pg ?? row.AST ?? row.assists),
    steals_pg: toNumber(row.steals_pg ?? row.STL ?? row.steals),
    blocks_pg: toNumber(row.blocks_pg ?? row.BLK ?? row.blocks),
    field_goal_pct_pg: toNumber(row.field_goal_pct_pg ?? row.FG_PCT ?? row.field_goal_pct),
    three_point_pct_pg: toNumber(
      row.three_point_pct_pg ?? row.FG3_PCT ?? row.three_point_pct
    ),
    free_throw_pct_pg: toNumber(row.free_throw_pct_pg ?? row.FT_PCT ?? row.free_throw_pct),
    true_shooting_pct_pg: toNumber(
      row.true_shooting_pct_pg ?? row.TS_PCT ?? row.true_shooting_pct
    ),
    season_type: resolvedSeasonType,
  };
}

function extractResultSetRows(payload, targetName) {
  const resultSets = payload?.resultSets || payload?.resultSet || [];
  const sets = Array.isArray(resultSets) ? resultSets : [resultSets];
  const target =
    sets.find(
      (set) =>
        String(set?.name || "")
          .trim()
          .toLowerCase() === targetName.toLowerCase()
    ) || sets[0];
  if (!target || !Array.isArray(target.headers) || !Array.isArray(target.rowSet)) {
    return [];
  }
  return target.rowSet.map((row) => {
    const record = {};
    target.headers.forEach((header, index) => {
      record[header] = row[index];
    });
    return record;
  });
}

function applyRanks(rows, valueKey, rankKey, descending = true) {
  const sorted = rows
    .filter((row) => row[valueKey] !== null && row[valueKey] !== undefined)
    .sort((a, b) => {
      if (descending) {
        return (b[valueKey] ?? 0) - (a[valueKey] ?? 0);
      }
      return (a[valueKey] ?? 0) - (b[valueKey] ?? 0);
    });
  sorted.forEach((row, index) => {
    row[rankKey] = index + 1;
  });
}

async function apiRequest(path) {
  if (isCircuitOpen()) {
    throw new CircuitOpenError("API circuit open; skipping request");
  }
  throwIfCronBudgetExceeded("api_request");
  const url = path.startsWith("http") ? path : `${CONFIG.apiBaseUrl}${path}`;
  const queued = requestQueue.then(async () => {
    if (isCircuitOpen()) {
      throw new CircuitOpenError("API circuit open; skipping request");
    }
    throwIfCronBudgetExceeded("api_request");
    const waitMs = Math.max(0, CONFIG.apiMinIntervalMs - (Date.now() - lastApiRequestAt));
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    lastApiRequestAt = Date.now();
    return requestWithRetry(url);
  }, async () => {
    if (isCircuitOpen()) {
      throw new CircuitOpenError("API circuit open; skipping request");
    }
    throwIfCronBudgetExceeded("api_request");
    const waitMs = Math.max(0, CONFIG.apiMinIntervalMs - (Date.now() - lastApiRequestAt));
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    lastApiRequestAt = Date.now();
    return requestWithRetry(url);
  });
  requestQueue = queued.catch(() => {});
  return queued;
}

async function statsRequest(url) {
  throwIfCronBudgetExceeded("stats_request");
  const queued = statsRequestQueue.then(async () => {
    throwIfCronBudgetExceeded("stats_request");
    const waitMs = Math.max(0, CONFIG.apiMinIntervalMs - (Date.now() - lastStatsRequestAt));
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    lastStatsRequestAt = Date.now();
    return statsRequestWithRetry(url);
  }, async () => {
    throwIfCronBudgetExceeded("stats_request");
    const waitMs = Math.max(0, CONFIG.apiMinIntervalMs - (Date.now() - lastStatsRequestAt));
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    lastStatsRequestAt = Date.now();
    return statsRequestWithRetry(url);
  });
  statsRequestQueue = queued.catch(() => {});
  return queued;
}

function computeRetryWaitMs(delay, retryAfterSeconds) {
  const baseWaitMs =
    Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : delay + Math.floor(Math.random() * 200);
  return Math.max(baseWaitMs, 30_000);
}

async function requestWithRetry(url) {
  let attempt = 0;
  let delay = CONFIG.apiRetryBaseDelayMs;
  while (attempt <= CONFIG.apiRetryMax) {
    throwIfCronBudgetExceeded("api_request");
    let response;
    try {
      response = await fetch(url, {
        headers: {
          "x-api-key": CONFIG.apiKey,
        },
      });
    } catch (error) {
      if (attempt >= CONFIG.apiRetryMax) {
        recordApiFailure();
        throw new Error(`API request failed: ${String(error)}`);
      }
      const waitMs = computeRetryWaitMs(delay);
      log("API request failed; backing off", {
        error: String(error),
        wait_ms: waitMs,
      });
      await sleep(waitMs);
      delay *= 2;
      attempt += 1;
      continue;
    }
    if (response.ok) {
      const payload = await response.json();
      if (!payload || !payload.ok) {
        throw new Error(`API error: ${JSON.stringify(payload)}`);
      }
      recordApiSuccess();
      return payload;
    }
    const body = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable) {
      throw new Error(`API ${response.status}: ${body}`);
    }
    if (attempt >= CONFIG.apiRetryMax) {
      recordApiFailure();
      throw new Error(`API ${response.status}: ${body}`);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs = computeRetryWaitMs(delay, retryAfter);
    log("API request throttled; backing off", {
      status: response.status,
      wait_ms: waitMs,
    });
    await sleep(waitMs);
    delay *= 2;
    attempt += 1;
  }
  throw new Error("API request failed after retries");
}

async function statsRequestWithRetry(url) {
  let attempt = 0;
  let delay = CONFIG.apiRetryBaseDelayMs;
  while (attempt <= CONFIG.apiRetryMax) {
    throwIfCronBudgetExceeded("stats_request");
    let response;
    try {
      response = await fetch(url, {
        headers: NBA_STATS_HEADERS,
      });
    } catch (error) {
      if (attempt >= CONFIG.apiRetryMax) {
        throw new Error(`NBA stats request failed: ${String(error)}`);
      }
      const waitMs = computeRetryWaitMs(delay);
      log("NBA stats request failed; backing off", {
        error: String(error),
        wait_ms: waitMs,
      });
      await sleep(waitMs);
      delay *= 2;
      attempt += 1;
      continue;
    }
    if (response.ok) {
      return response.json();
    }
    const body = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable) {
      throw new Error(`NBA stats ${response.status}: ${body}`);
    }
    if (attempt >= CONFIG.apiRetryMax) {
      throw new Error(`NBA stats ${response.status}: ${body}`);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs = computeRetryWaitMs(delay, retryAfter);
    log("NBA stats request throttled; backing off", {
      status: response.status,
      wait_ms: waitMs,
    });
    await sleep(waitMs);
    delay *= 2;
    attempt += 1;
  }
  throw new Error("NBA stats request failed after retries");
}

function dedupeRowsForConflict(rows, onConflict) {
  if (!onConflict || !Array.isArray(rows) || rows.length < 2) return rows;
  const keys = onConflict
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  if (!keys.length) return rows;
  const seen = new Map();
  rows.forEach((row, index) => {
    const values = keys.map((key) => normalizeConflictValue(row?.[key]));
    const canDedupe = values.every((value) => value !== null);
    const dedupeKey = canDedupe ? JSON.stringify(values) : `__index:${index}`;
    seen.set(dedupeKey, row);
  });
  if (seen.size === rows.length) return rows;
  return Array.from(seen.values());
}

function shouldRecordIngestionState(table) {
  return Boolean(table && table !== "ingestion_state");
}

async function supabaseInsertRaw(table, rows) {
  if (!rows || rows.length === 0) return;
  const url = new URL(`${CONFIG.supabaseUrl}/rest/v1/${table}`);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      apikey: CONFIG.supabaseKey,
      Authorization: `Bearer ${CONFIG.supabaseKey}`,
      "Content-Type": "application/json",
      "Content-Profile": CONFIG.supabaseSchema,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase ${table} insert failed: ${response.status} ${body}`);
  }
}

async function supabaseInsert(table, rows, options = {}) {
  const recordState = options.recordState !== false && shouldRecordIngestionState(table);
  const cursor = options.cursor ?? null;
  if (recordState) {
    await updateIngestionState(table, "running", cursor, null);
  }
  try {
    await supabaseInsertRaw(table, rows);
    if (recordState) {
      await updateIngestionState(table, "ok", cursor, null);
    }
  } catch (error) {
    if (recordState) {
      await updateIngestionState(table, "failed", cursor, String(error));
    }
    throw error;
  }
}

async function supabaseDeleteRaw(table, filters) {
  const url = new URL(`${CONFIG.supabaseUrl}/rest/v1/${table}`);
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });
  const response = await fetch(url.toString(), {
    method: "DELETE",
    headers: {
      apikey: CONFIG.supabaseKey,
      Authorization: `Bearer ${CONFIG.supabaseKey}`,
      "Content-Profile": CONFIG.supabaseSchema,
      Prefer: "return=minimal",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase ${table} delete failed: ${response.status} ${body}`);
  }
}

async function supabaseDelete(table, filters, options = {}) {
  const recordState = options.recordState !== false && shouldRecordIngestionState(table);
  const cursor = options.cursor ?? null;
  if (recordState) {
    await updateIngestionState(table, "running", cursor, null);
  }
  try {
    await supabaseDeleteRaw(table, filters);
    if (recordState) {
      await updateIngestionState(table, "ok", cursor, null);
    }
  } catch (error) {
    if (recordState) {
      await updateIngestionState(table, "failed", cursor, String(error));
    }
    throw error;
  }
}

function isNoUniqueConstraintError(error) {
  const message = String(error || "");
  return (
    message.includes("\"code\":\"42P10\"") ||
    message.includes("no unique or exclusion constraint matching the ON CONFLICT specification")
  );
}

function isCircuitOpenError(error) {
  return error instanceof CircuitOpenError || String(error).includes("API circuit open");
}

async function supabaseUpsertRaw(table, rows, onConflict) {
  if (!rows || rows.length === 0) return;
  const payload = dedupeRowsForConflict(rows, onConflict);
  if (!payload || payload.length === 0) return;
  const url = new URL(`${CONFIG.supabaseUrl}/rest/v1/${table}`);
  if (onConflict) {
    url.searchParams.set("on_conflict", onConflict);
  }
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      apikey: CONFIG.supabaseKey,
      Authorization: `Bearer ${CONFIG.supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
      "Content-Profile": CONFIG.supabaseSchema,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase ${table} upsert failed: ${response.status} ${body}`);
  }
}

async function supabaseUpsert(table, rows, onConflict, options = {}) {
  const recordState = options.recordState !== false && shouldRecordIngestionState(table);
  const cursor = options.cursor ?? null;
  if (recordState) {
    await updateIngestionState(table, "running", cursor, null);
  }
  try {
    await supabaseUpsertRaw(table, rows, onConflict);
    if (recordState) {
      await updateIngestionState(table, "ok", cursor, null);
    }
  } catch (error) {
    const message = String(error || "");
    const isDuplicateConflict =
      message.includes("\"code\":\"21000\"") ||
      message.includes("ON CONFLICT DO UPDATE command cannot affect row a second time");
    if (isDuplicateConflict && Array.isArray(rows) && rows.length > 1) {
      log("Supabase upsert conflict detected; retrying rows individually", {
        table,
        count: rows.length,
      });
      for (const row of rows) {
        await supabaseUpsertRaw(table, [row], onConflict);
      }
      if (recordState) {
        await updateIngestionState(table, "ok", cursor, null);
      }
      return;
    }
    if (recordState) {
      await updateIngestionState(table, "failed", cursor, message);
    }
    throw error;
  }
}

async function supabaseSelect(table, query) {
  const url = new URL(`${CONFIG.supabaseUrl}/rest/v1/${table}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });
  const response = await fetch(url.toString(), {
    headers: {
      apikey: CONFIG.supabaseKey,
      Authorization: `Bearer ${CONFIG.supabaseKey}`,
      "Accept-Profile": CONFIG.supabaseSchema,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase ${table} select failed: ${response.status} ${body}`);
  }
  return response.json();
}

async function supabaseSelectAll(table, query, pageSize = 1000) {
  const rows = [];
  let offset = 0;
  while (true) {
    throwIfCronBudgetExceeded("supabase_select_all");
    const chunk = await supabaseSelect(table, {
      ...query,
      limit: pageSize,
      offset,
    });
    if (!Array.isArray(chunk) || chunk.length === 0) {
      break;
    }
    rows.push(...chunk);
    if (chunk.length < pageSize) {
      break;
    }
    offset += pageSize;
  }
  return rows;
}

async function updateIngestionState(entity, status, cursor, errorMessage) {
  const now = new Date().toISOString();
  const row = {
    source: "nba_api",
    entity,
    status,
    last_attempt_at: now,
    last_cursor: cursor ? JSON.stringify(cursor) : null,
    last_error: errorMessage || null,
  };
  if (status === "ok") {
    row.last_success_at = now;
  }
  await supabaseUpsertRaw("ingestion_state", [row], "source,entity");
}

async function getIngestionState(entity) {
  const rows = await supabaseSelect("ingestion_state", {
    select: "last_success_at,last_cursor",
    source: "eq.nba_api",
    entity: `eq.${entity}`,
    limit: 1,
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function parseCursor(state) {
  if (!state || !state.last_cursor) return null;
  try {
    return JSON.parse(state.last_cursor);
  } catch {
    return null;
  }
}

function parseCronBudgetCursor(cursor) {
  if (!cursor || typeof cursor !== "object") {
    return { date: null, runs: 0, next_run_after: null, window: null };
  }
  const date = typeof cursor.date === "string" ? cursor.date : null;
  const runs = Number(cursor.runs);
  const window =
    typeof cursor.window === "string" && cursor.window.trim()
      ? cursor.window.trim()
      : null;
  const nextValue = cursor.next_run_after ?? cursor.nextRunAfter ?? null;
  const nextRunAfter =
    typeof nextValue === "number"
      ? nextValue
      : typeof nextValue === "string"
      ? Date.parse(nextValue)
      : null;
  return {
    date,
    runs: Number.isFinite(runs) ? runs : 0,
    next_run_after: Number.isFinite(nextRunAfter) ? nextRunAfter : null,
    window,
  };
}

function getCronIntervalMs(inWindow) {
  if (inWindow) {
    const rawMin = CONFIG.cronInWindowMinIntervalMs;
    const minInterval = Number.isFinite(rawMin) ? Math.max(0, rawMin) : 0;
    const rawMax = CONFIG.cronInWindowMaxIntervalMs;
    const maxInterval = Number.isFinite(rawMax)
      ? Math.max(minInterval, rawMax)
      : minInterval;
    if (maxInterval === 0) return 0;
    if (maxInterval === minInterval) return minInterval;
    return minInterval + Math.floor(Math.random() * (maxInterval - minInterval + 1));
  }
  const rawOff = CONFIG.cronOffWindowIntervalMs;
  return Number.isFinite(rawOff) ? Math.max(0, rawOff) : 0;
}

function computeNextRunAfter(inWindow, nowMs) {
  const intervalMs = getCronIntervalMs(inWindow);
  return intervalMs > 0 ? nowMs + intervalMs : null;
}

async function recordCronRunState(status, date, runs, cursor, errorMessage) {
  await updateIngestionState(
    "cron_budget",
    status,
    { date, runs, ...(cursor || {}) },
    errorMessage
  );
}

async function shouldStartCronRun() {
  const now = new Date();
  const date = formatDateInTZ(CONFIG.timeZone, now);
  const hour = getHourInTZ(CONFIG.timeZone, now);
  const startHour = normalizeHour(CONFIG.cronWindowStartHour);
  const endHour = normalizeHour(CONFIG.cronWindowEndHour);
  const inWindow = isHourInWindow(hour, startHour, endHour);
  const windowLabel = inWindow ? "in" : "out";

  const maxRuns = CONFIG.cronMaxRunsPerDay;
  const enforceMaxRuns = Number.isFinite(maxRuns) && maxRuns > 0;
  const state = await getIngestionState("cron_budget");
  const cursor = parseCronBudgetCursor(parseCursor(state));
  const runs = cursor.date === date ? cursor.runs : 0;
  if (enforceMaxRuns && runs >= maxRuns) {
    log("Cron daily limit reached; skipping run", {
      date,
      runs,
      max_runs_per_day: maxRuns,
    });
    return { allowed: false, date, hour, runs, inWindow };
  }

  const lastAttemptAt = state?.last_attempt_at || state?.last_success_at || null;
  const lastAttemptMs = lastAttemptAt ? Date.parse(lastAttemptAt) : null;
  const normalizedCursor =
    cursor.date === date
      ? cursor
      : { ...cursor, runs: 0, next_run_after: null, window: null };
  const windowMatches = normalizedCursor.window === windowLabel;
  const nextRunAfter = windowMatches ? normalizedCursor.next_run_after : null;
  const nowMs = now.getTime();

  if (Number.isFinite(nextRunAfter) && nowMs < nextRunAfter) {
    log("Cron interval not reached; skipping run", {
      date,
      hour,
      next_run_after: new Date(nextRunAfter).toISOString(),
      window: windowLabel,
    });
    return { allowed: false, date, hour, runs, inWindow };
  }

  if (Number.isFinite(lastAttemptMs)) {
    const minIntervalMs = inWindow
      ? Number.isFinite(CONFIG.cronInWindowMinIntervalMs)
        ? Math.max(0, CONFIG.cronInWindowMinIntervalMs)
        : 0
      : Number.isFinite(CONFIG.cronOffWindowIntervalMs)
      ? Math.max(0, CONFIG.cronOffWindowIntervalMs)
      : 0;
    if (minIntervalMs > 0 && nowMs - lastAttemptMs < minIntervalMs) {
      log("Cron minimum interval not reached; skipping run", {
        date,
        hour,
        window: windowLabel,
        min_interval_ms: minIntervalMs,
      });
      return { allowed: false, date, hour, runs, inWindow };
    }
  }

  return { allowed: true, date, hour, runs, inWindow };
}

async function shouldRun(entity, intervalMs) {
  const state = await getIngestionState(entity);
  if (!state || !state.last_success_at) {
    return true;
  }
  const lastSuccess = Date.parse(state.last_success_at);
  if (Number.isNaN(lastSuccess)) {
    return true;
  }
  const minInterval =
    CONFIG.workerMode === "cron"
      ? Math.max(intervalMs, CONFIG.cronMinIntervalMs)
      : intervalMs;
  return Date.now() - lastSuccess >= minInterval;
}

function chunkArray(rows, size) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

async function withIngestionState(entity, fn, cursor) {
  try {
    await updateIngestionState(entity, "running", cursor, null);
    await fn();
    await updateIngestionState(entity, "ok", cursor, null);
  } catch (error) {
    await updateIngestionState(entity, "failed", cursor, String(error));
    throw error;
  }
}

async function getSeason() {
  if (CONFIG.seasonOverride) {
    return CONFIG.seasonOverride;
  }
  const seasons = await getSupportedSeasons();
  const preferred = getSeasonForDate(CONFIG.timeZone);
  if (seasons.includes(preferred)) {
    return preferred;
  }
  const fallback = seasons.at(-1);
  if (!fallback) {
    throw new Error("Unable to determine active season");
  }
  return fallback;
}

async function getSupportedSeasons() {
  const now = Date.now();
  if (cachedSupportedSeasons && now - cachedSupportedSeasonsAt < 6 * 60 * 60 * 1000) {
    return cachedSupportedSeasons;
  }
  const payload = await apiRequest("/v1/meta");
  const seasons = payload.data?.supported_seasons || [];
  if (!seasons.length) {
    throw new Error("Unable to determine supported seasons");
  }
  cachedSupportedSeasons = seasons;
  cachedSupportedSeasonsAt = now;
  cachedSeason = seasons.at(-1) || null;
  cachedSeasonAt = now;
  return seasons;
}

function seasonsUpToCurrent(supported, currentSeason) {
  const currentIndex = supported.indexOf(currentSeason);
  if (currentIndex === -1) return supported;
  return supported.slice(0, currentIndex + 1);
}

async function getSeasonsToSync() {
  return getSeasonsToSyncWithOptions();
}

async function getSeasonsToSyncWithOptions(options = {}) {
  const supported = await getSupportedSeasons();
  const seasonSet = new Set();
  const currentSeason = await getSeason();
  const supportedUpToCurrent = seasonsUpToCurrent(supported, currentSeason);
  seasonSet.add(currentSeason);

  const manualSeasons = parseSeasonList(options.historicSeasons ?? CONFIG.historicSeasons);
  manualSeasons.forEach((season) => seasonSet.add(season));

  const historicBack = options.historicSeasonsBack ?? CONFIG.historicSeasonsBack;
  if (historicBack > 0) {
    const recent = supportedUpToCurrent.slice(-historicBack);
    recent.forEach((season) => seasonSet.add(season));
  }

  const ordered = supported.filter((season) => seasonSet.has(season));
  const extras = manualSeasons.filter((season) => !supported.includes(season));
  const combined = ordered.concat(extras);
  const currentIndex = combined.indexOf(currentSeason);
  if (currentIndex !== -1 && currentIndex !== combined.length - 1) {
    combined.splice(currentIndex, 1);
    combined.push(currentSeason);
  }
  return combined;
}

async function fetchTeamsForSeason(season) {
  const payload = await apiRequest(`/v1/teams?season=${season}`);
  return payload.data || [];
}

async function fetchGamesFromApi(season) {
  let page = 1;
  const pageSize = 200;
  const games = [];
  while (true) {
    throwIfCronBudgetExceeded("games_page");
    const payload = await apiRequest(
      `/v1/games?season=${season}&page=${page}&page_size=${pageSize}`
    );
    const rows = payload.data || [];
    games.push(...rows);
    const nextPage = payload.meta?.pagination?.next;
    if (!nextPage) break;
    page = nextPage;
  }
  return games;
}

async function loadGamesForSeason(season) {
  const seasonYear = seasonToYear(season);
  const query = {
    select: "game_id,home_team_id,home_team_score,away_team_id,away_team_score",
  };
  if (seasonYear !== null && seasonYear !== undefined) {
    query.season = `eq.${seasonYear}`;
  }
  const rows = await supabaseSelectAll("games", query);
  if (rows.length) {
    return rows;
  }
  return fetchGamesFromApi(season);
}

async function fetchBoxscoreAdvancedTeamStats(gameId) {
  const url = new URL("https://stats.nba.com/stats/boxscoreadvancedv2");
  url.searchParams.set("GameID", gameId);
  url.searchParams.set("StartPeriod", "0");
  url.searchParams.set("EndPeriod", "0");
  url.searchParams.set("StartRange", "0");
  url.searchParams.set("EndRange", "0");
  url.searchParams.set("RangeType", "0");
  const payload = await statsRequest(url.toString());
  return extractResultSetRows(payload, "TeamStats");
}

async function fetchLeagueDashPlayerStats(season, seasonType) {
  const url = new URL("https://stats.nba.com/stats/leaguedashplayerstats");
  const params = {
    Season: season,
    SeasonType: seasonType,
    PerMode: "PerGame",
    MeasureType: "Base",
    LeagueID: "00",
    PlusMinus: "N",
    PaceAdjust: "N",
    Rank: "N",
    Outcome: "",
    Location: "",
    Month: "0",
    SeasonSegment: "",
    DateFrom: "",
    DateTo: "",
    OpponentTeamID: "0",
    VsConference: "",
    VsDivision: "",
    GameSegment: "",
    Period: "0",
    LastNGames: "0",
    GameScope: "",
    PlayerExperience: "",
    PlayerPosition: "",
    StarterBench: "",
    TwoWay: "",
    Conference: "",
    Division: "",
    PORound: "0",
    ShotClockRange: "",
    DistanceRange: "",
  };
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });
  const payload = await statsRequest(url.toString());
  return extractResultSetRows(payload, "LeagueDashPlayerStats");
}

async function fetchLeagueDashPlayerBioStats(season, seasonType) {
  const url = new URL("https://stats.nba.com/stats/leaguedashplayerbiostats");
  const params = {
    Season: season,
    SeasonType: seasonType,
    PerMode: "PerGame",
    LeagueID: "00",
    PlusMinus: "N",
    PaceAdjust: "N",
    Rank: "N",
    Outcome: "",
    Location: "",
    Month: "0",
    SeasonSegment: "",
    DateFrom: "",
    DateTo: "",
    OpponentTeamID: "0",
    VsConference: "",
    VsDivision: "",
    GameSegment: "",
    Period: "0",
    LastNGames: "0",
    GameScope: "",
    PlayerExperience: "",
    PlayerPosition: "",
    StarterBench: "",
    TwoWay: "",
    Conference: "",
    Division: "",
    PORound: "0",
    ShotClockRange: "",
    DistanceRange: "",
  };
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });
  const payload = await statsRequest(url.toString());
  return extractResultSetRows(payload, "LeagueDashPlayerBioStats");
}

function mapPlayerBioRow(row) {
  if (!row) return null;
  const playerId = toPlayerId(row.PLAYER_ID ?? row.player_id ?? row.PERSON_ID ?? row.id);
  if (!playerId) return null;
  return {
    player_id: playerId,
    height: toText(row.PLAYER_HEIGHT ?? row.HEIGHT),
    weight: toNumber(row.PLAYER_WEIGHT ?? row.WEIGHT),
    draft_year: toNumber(row.DRAFT_YEAR),
    draft_pick: toText(row.DRAFT_NUMBER ?? row.DRAFT_PICK),
    country: toText(row.COUNTRY),
    college: toText(row.COLLEGE),
  };
}

async function fetchPlayerIds(season, { activeOnly = false, maxPlayers = 0 } = {}) {
  let page = 1;
  const pageSize = 200;
  const players = [];
  const activeParam = activeOnly ? "&active=true" : "";
  while (true) {
    throwIfCronBudgetExceeded("players_page");
    const payload = await apiRequest(
      `/v1/players?season=${season}&page=${page}&page_size=${pageSize}${activeParam}`
    );
    const rows = payload.data || [];
    for (const row of rows) {
      if (row && row.id) {
        players.push(row.id);
      }
      if (maxPlayers && players.length >= maxPlayers) {
        return players;
      }
    }
    const nextPage = payload.meta?.pagination?.next;
    if (!nextPage) break;
    page = nextPage;
  }
  return players;
}

async function refreshTeams() {
  const season = await getSeason();
  await withIngestionState("teams", async () => {
    const payload = await apiRequest(`/v1/teams?season=${season}`);
    const rows = (payload.data || []).map(mapTeamRow).filter(Boolean);
    await supabaseUpsert("teams", rows, "team_id");
    await writeCache(CacheKeys.teams(season), payload.data, CONFIG.cacheTtlTeamsSec);
    logUpsert("teams", rows.length, { season });
  }, { season });
}

async function refreshGames() {
  const seasons = await getSeasonsToSync();
  await withIngestionState("games", async () => {
    for (const season of seasons) {
      throwIfCronBudgetExceeded("games_season");
      let page = 1;
      const pageSize = 200;
      let total = 0;
      while (true) {
        throwIfCronBudgetExceeded("games_page");
        const payload = await apiRequest(
          `/v1/games?season=${season}&page=${page}&page_size=${pageSize}`
        );
        const rows = (payload.data || []).map((row) => mapGameRow(row, season)).filter(Boolean);
        if (rows.length) {
          await supabaseUpsert("games", rows, "game_id");
          total += rows.length;
        }
        const nextPage = payload.meta?.pagination?.next;
        if (!nextPage) break;
        page = nextPage;
      }
      logUpsert("games", total, { season });
    }
  }, { seasons });
}

async function refreshPlayersForSeason(season) {
  let page = 1;
  const pageSize = 200;
  let total = 0;
  while (true) {
    throwIfCronBudgetExceeded("players_page");
    const payload = await apiRequest(
      `/v1/players?season=${season}&page=${page}&page_size=${pageSize}`
    );
    const rows = (payload.data || []).map(mapPlayerRow).filter(Boolean);
    if (rows.length) {
      await supabaseUpsert("players", rows, "player_id");
      total += rows.length;
    }
    const nextPage = payload.meta?.pagination?.next;
    if (!nextPage) break;
    page = nextPage;
  }
  logUpsert("players", total, { season });

  try {
    const bioRows = await fetchLeagueDashPlayerBioStats(season, "Regular Season");
    const updates = (bioRows || []).map(mapPlayerBioRow).filter(Boolean);
    if (updates.length) {
      await supabaseUpsert("players", updates, "player_id");
      logUpsert("players_bio", updates.length, { season });
    }
  } catch (error) {
    log("Failed to refresh player bio stats", { season, error: String(error) });
  }
}

async function refreshPlayers() {
  const currentSeason = await getSeason();
  let seasons = [currentSeason];
  const configuredSeasons = await getSeasonsToSyncWithOptions({
    historicSeasonsBack: CONFIG.playersHistoricSeasonsBack,
  });
  let cursor = {
    seasons: configuredSeasons,
    historic_complete: false,
    historic_seasons: configuredSeasons,
    mode: CONFIG.playersHistoricMode,
  };

  if (CONFIG.playersHistoricMode === "off") {
    seasons = [currentSeason];
  } else if (CONFIG.playersHistoricMode === "always") {
    seasons = configuredSeasons;
  } else {
    const state = await getIngestionState("players");
    const previousCursor = parseCursor(state);
    const historicComplete =
      previousCursor?.historic_complete &&
      seasonsMatch(previousCursor?.historic_seasons, configuredSeasons);
    if (historicComplete) {
      seasons = [currentSeason];
      cursor = {
        seasons,
        historic_complete: true,
        historic_seasons: configuredSeasons,
        mode: CONFIG.playersHistoricMode,
      };
    } else {
      seasons = configuredSeasons;
      cursor = {
        seasons,
        historic_complete: true,
        historic_seasons: configuredSeasons,
        mode: CONFIG.playersHistoricMode,
      };
    }
  }

  await withIngestionState("players", async () => {
    for (const season of seasons) {
      throwIfCronBudgetExceeded("players_season");
      await refreshPlayersForSeason(season);
    }
  }, cursor);
}

async function refreshStandings() {
  const seasons = await getSeasonsToSync();
  await withIngestionState("league_standings", async () => {
    for (const season of seasons) {
      throwIfCronBudgetExceeded("standings_season");
      const payload = await apiRequest(`/v1/league_standings?season=${season}`);
      const rows = (payload.data || [])
        .map((row) => mapLeagueStandingRow(row, season))
        .filter(Boolean);
      await supabaseUpsert("league_standings", rows, "season,team_id");
      await writeCache(
        CacheKeys.standings(season),
        payload.data || [],
        CONFIG.cacheTtlStandingsSec
      );
      logUpsert("league_standings", rows.length, { season });
    }
  }, { seasons });
}

async function refreshTeamStats() {
  const seasons = await getSeasonsToSync();
  await withIngestionState("team_advanced_stats", async () => {
    for (const season of seasons) {
      throwIfCronBudgetExceeded("team_stats_season");
      const games = await loadGamesForSeason(season);
      const aggregates = new Map();

      const ensureEntry = (teamId) => {
        if (!aggregates.has(teamId)) {
          aggregates.set(teamId, {
            team_id: teamId,
            games_played: 0,
            points_for: 0,
            points_against: 0,
            ortg_sum: 0,
            ortg_count: 0,
            drtg_sum: 0,
            drtg_count: 0,
            netrtg_sum: 0,
            netrtg_count: 0,
            assists_sum: 0,
            assists_count: 0,
            turnovers_sum: 0,
            turnovers_count: 0,
          });
        }
        return aggregates.get(teamId);
      };

      let gameIndex = 0;
      for (const game of games) {
        if (gameIndex % 50 === 0) {
          throwIfCronBudgetExceeded("team_stats_games");
        }
        gameIndex += 1;
        const homeId = toNumber(game.home_team_id ?? game.HOME_TEAM_ID);
        const awayId = toNumber(game.away_team_id ?? game.AWAY_TEAM_ID);
        const homeScore = toNumber(game.home_team_score ?? game.HOME_TEAM_SCORE);
        const awayScore = toNumber(game.away_team_score ?? game.AWAY_TEAM_SCORE);
        if (homeId !== null && homeScore !== null) {
          const entry = ensureEntry(homeId);
          entry.games_played += 1;
          entry.points_for += homeScore;
          if (awayScore !== null) {
            entry.points_against += awayScore;
          }
        }
        if (awayId !== null && awayScore !== null) {
          const entry = ensureEntry(awayId);
          entry.games_played += 1;
          entry.points_for += awayScore;
          if (homeScore !== null) {
            entry.points_against += homeScore;
          }
        }
      }

      const gameIds = games
        .filter((game) => {
          const homeScore = toNumber(game.home_team_score ?? game.HOME_TEAM_SCORE);
          const awayScore = toNumber(game.away_team_score ?? game.AWAY_TEAM_SCORE);
          return Boolean(game.game_id) && homeScore !== null && awayScore !== null;
        })
        .map((game) => game.game_id);

      await runWithConcurrency(gameIds, CONFIG.boxscoreConcurrency, async (gameId) => {
        const teamRows = await fetchBoxscoreAdvancedTeamStats(gameId);
        for (const row of teamRows) {
          const teamId = toNumber(row.TEAM_ID);
          if (teamId === null) continue;
          const entry = ensureEntry(teamId);
          const ortg = toNumber(row.OFF_RATING ?? row.OFF_RTG ?? row.E_OFF_RATING);
          if (ortg !== null) {
            entry.ortg_sum += ortg;
            entry.ortg_count += 1;
          }
          const drtg = toNumber(row.DEF_RATING ?? row.DEF_RTG ?? row.E_DEF_RATING);
          if (drtg !== null) {
            entry.drtg_sum += drtg;
            entry.drtg_count += 1;
          }
          const netrtg = toNumber(row.NET_RATING ?? row.NET_RTG ?? row.NETRTG);
          if (netrtg !== null) {
            entry.netrtg_sum += netrtg;
            entry.netrtg_count += 1;
          }
          const assists = toNumber(row.AST);
          if (assists !== null) {
            entry.assists_sum += assists;
            entry.assists_count += 1;
          }
          const turnovers = toNumber(row.TOV ?? row.TO);
          if (turnovers !== null) {
            entry.turnovers_sum += turnovers;
            entry.turnovers_count += 1;
          }
        }
      });

      const rows = [];
      for (const entry of aggregates.values()) {
        const gamesPlayed = entry.games_played || 0;
        rows.push({
          season,
          team_id: entry.team_id,
          ppg: gamesPlayed ? entry.points_for / gamesPlayed : null,
          ppg_allowed: gamesPlayed ? entry.points_against / gamesPlayed : null,
          ortg: entry.ortg_count ? entry.ortg_sum / entry.ortg_count : null,
          ortg_rank: null,
          drtg: entry.drtg_count ? entry.drtg_sum / entry.drtg_count : null,
          drtg_rank: null,
          apg: entry.assists_count ? entry.assists_sum / entry.assists_count : null,
          topg: entry.turnovers_count ? entry.turnovers_sum / entry.turnovers_count : null,
          netrtg: entry.netrtg_count ? entry.netrtg_sum / entry.netrtg_count : null,
        });
      }

      applyRanks(rows, "ortg", "ortg_rank", true);
      applyRanks(rows, "drtg", "drtg_rank", false);

      if (rows.length) {
        await supabaseUpsert("team_advanced_stats", rows, "season,team_id");
      }
      logUpsert("team_advanced_stats", rows.length, { season });
    }
  }, { seasons });
}

async function refreshTeamDetails() {
  const season = await getSeason();
  await withIngestionState("team_details", async () => {
    throwIfCronBudgetExceeded("team_details");
    const teams = await fetchTeamsForSeason(season);
    await runWithConcurrency(teams, CONFIG.boxscoreConcurrency, async (team) => {
      const payload = await apiRequest(`/v1/teams/${team.id}/details`);
      const detail = payload.data || {};
      const row = mapTeamDetailRow(detail, team.id);
      if (row && row.team_id) {
        await supabaseUpsert("team_details", [row], "team_id");
      }
    });
    logUpsert("team_details", teams.length, { season });
  }, { season });
}

async function refreshPlayerAwards() {
  const season = await getSeason();
  throwIfCronBudgetExceeded("player_awards");
  const playerIds = await fetchPlayerIds(season, {
    activeOnly: CONFIG.playerAwardsActiveOnly,
  });
  await withIngestionState("player_awards", async () => {
    let total = 0;
    await runWithConcurrency(playerIds, CONFIG.boxscoreConcurrency, async (playerId) => {
      const payload = await apiRequest(`/v1/players/${playerId}/awards`);
      const rows = (payload.data || [])
        .map((row) => mapPlayerAwardRow(row, playerId))
        .filter(Boolean);
      if (rows.length) {
        await supabaseUpsert("player_awards", rows, "player_id,season,description");
        total += rows.length;
      }
    });
    logUpsert("player_awards", total, { season, player_count: playerIds.length });
  }, { season, player_count: playerIds.length });
}

async function refreshPlayerSeasonStatsForSeason(season) {
  const seasonType = "Regular Season";
  const payloadRows = await fetchLeagueDashPlayerStats(season, seasonType);
  const rows = payloadRows
    .map((row) => mapPlayerSeasonStatsRow(row, season, seasonType))
    .filter(Boolean);
  if (rows.length) {
    await supabaseUpsert("player_season_stats", rows, "season,player_id,season_type");
  }
  logUpsert("player_season_stats", rows.length, { season });
}

async function refreshPlayerSeasonStats() {
  const seasons = await getSeasonsToSync();
  await withIngestionState("player_season_stats", async () => {
    for (const season of seasons) {
      throwIfCronBudgetExceeded("player_season_stats_season");
      await refreshPlayerSeasonStatsForSeason(season);
    }
  }, { seasons });
}

async function fetchBoxscore(gameId) {
  const payload = await apiRequest(`/v1/boxscores/${gameId}`);
  return payload.data;
}

function toBoxscoreRow(boxscore) {
  return {
    game_id: boxscore.game_id,
    status: boxscore.status || "unknown",
    game_date: toText(boxscore.game_date),
    start_time: toText(boxscore.start_time),
    arena: boxscore.arena ?? null,
    attendance:
      boxscore.attendance === undefined || boxscore.attendance === null
        ? null
        : String(boxscore.attendance),
    officials: toText(boxscore.officials),
    home_team: toText(boxscore.home_team),
    away_team: toText(boxscore.away_team),
    line_score: toText(boxscore.line_score),
    team_totals: toText(boxscore.team_totals),
  };
}

function toBoxscorePlayers(boxscore) {
  const advancedByPlayer = new Map();
  for (const row of boxscore.advanced_players || []) {
    const playerId = toPlayerId(row.player_id);
    if (!playerId) continue;
    advancedByPlayer.set(playerId, {
      offensive_rating: row.offensive_rating ?? null,
      defensive_rating: row.defensive_rating ?? null,
      net_rating: row.net_rating ?? null,
      usage_pct:
        row.usage_pct === undefined || row.usage_pct === null ? null : String(row.usage_pct),
      true_shooting_pct: row.true_shooting_pct ?? null,
      effective_fg_pct: row.effective_fg_pct ?? null,
    });
  }

  const combined = [];
  const seen = new Set();
  for (const row of boxscore.traditional_players || []) {
    const playerId = toPlayerId(row.player_id);
    if (!playerId) continue;
    seen.add(playerId);
    const advanced = advancedByPlayer.get(playerId) || {};
    combined.push({
      game_id: boxscore.game_id,
      player_id: playerId,
      player_name: row.player_name ?? null,
      team_id: row.team_id ?? null,
      team_abbreviation: row.team_abbreviation ?? null,
      minutes: row.minutes ?? null,
      stat_type: advancedByPlayer.has(playerId) ? "combined" : "traditional",
      start_position: row.start_position ?? null,
      field_goals_made: row.field_goals_made ?? null,
      field_goals_attempted: row.field_goals_attempted ?? null,
      field_goal_pct: row.field_goal_pct ?? null,
      three_point_made: row.three_point_made ?? null,
      three_point_attempted: row.three_point_attempted ?? null,
      three_point_pct: row.three_point_pct ?? null,
      free_throws_made: row.free_throws_made ?? null,
      free_throws_attempted: row.free_throws_attempted ?? null,
      free_throw_pct: row.free_throw_pct ?? null,
      offensive_rebounds: row.offensive_rebounds ?? null,
      defensive_rebounds: row.defensive_rebounds ?? null,
      rebounds: row.rebounds ?? null,
      assists: row.assists ?? null,
      steals: row.steals ?? null,
      blocks: row.blocks ?? null,
      turnovers: row.turnovers ?? null,
      fouls: row.fouls ?? null,
      points: row.points ?? null,
      plus_minus: row.plus_minus ?? null,
      ...advanced,
    });
  }

  for (const row of boxscore.advanced_players || []) {
    const playerId = toPlayerId(row.player_id);
    if (!playerId || seen.has(playerId)) continue;
    combined.push({
      game_id: boxscore.game_id,
      player_id: playerId,
      player_name: row.player_name ?? null,
      team_id: row.team_id ?? null,
      team_abbreviation: row.team_abbreviation ?? null,
      minutes: row.minutes ?? null,
      stat_type: "advanced",
      offensive_rating: row.offensive_rating ?? null,
      defensive_rating: row.defensive_rating ?? null,
      net_rating: row.net_rating ?? null,
      usage_pct:
        row.usage_pct === undefined || row.usage_pct === null ? null : String(row.usage_pct),
      true_shooting_pct: row.true_shooting_pct ?? null,
      effective_fg_pct: row.effective_fg_pct ?? null,
    });
  }

  return combined;
}

async function upsertBoxscore(boxscore) {
  await supabaseUpsert("boxscores", [toBoxscoreRow(boxscore)], "game_id");
  const players = toBoxscorePlayers(boxscore);
  if (players.length) {
    try {
      const chunks = chunkArray(players, CONFIG.upsertChunkSize);
      for (const chunk of chunks) {
        await supabaseUpsert("boxscore_players", chunk, "game_id,player_id");
      }
    } catch (error) {
      if (!isNoUniqueConstraintError(error)) {
        throw error;
      }
      log("boxscore_players missing unique constraint; replacing rows instead", {
        game_id: boxscore.game_id,
        count: players.length,
      });
      await supabaseDelete("boxscore_players", {
        game_id: `eq.${boxscore.game_id}`,
      });
      const chunks = chunkArray(players, CONFIG.upsertChunkSize);
      for (const chunk of chunks) {
        await supabaseInsert("boxscore_players", chunk);
      }
    }
  }
  return players.length;
}

async function updateBoxscoreForGame(gameId) {
  const boxscore = await fetchBoxscore(gameId);
  const playersCount = await upsertBoxscore(boxscore);
  const status = boxscore.status || null;
  const boxscoreTtl = isLiveStatus(status)
    ? CONFIG.cacheTtlBoxscoreLiveSec
    : CONFIG.cacheTtlBoxscoreFinalSec;
  await writeCache(CacheKeys.boxscore(gameId), boxscore, boxscoreTtl);
  statusCache.set(gameId, { status, checkedAt: Date.now() });
  if (isFinalStatus(status) || !isLiveStatus(status)) {
    activeGameIds.delete(gameId);
  } else {
    activeGameIds.add(gameId);
  }
  return { status, playersCount };
}

async function refreshScoreboard({ mode = CONFIG.workerMode } = {}) {
  const season = await getSeason();
  const today = formatDateInTZ(CONFIG.timeZone);
  await withIngestionState("scoreboard", async () => {
    const payload = await apiRequest(
      `/v1/games?season=${season}&date_from=${today}&date_to=${today}&page=1&page_size=200`
    );
    const games = payload.data || [];
    const rows = games.map((row) => mapGameRow(row, season)).filter(Boolean);
    await supabaseUpsert("games", rows, "game_id");
    logUpsert("games", rows.length, { season, date: today });
    const scoreboardTtl =
      today === formatDateInTZ(CONFIG.timeZone)
        ? CONFIG.cacheTtlScoreboardLiveSec
        : CONFIG.cacheTtlScoreboardFinalSec;
    await writeCache(CacheKeys.scoreboard(today), games, scoreboardTtl);

    const gameIds = games.map((game) => game.game_id);
    if (mode === "cron") {
      throwIfCronBudgetExceeded("scoreboard_boxscores");
      activeGameIds.clear();
      await runWithConcurrency(gameIds, CONFIG.boxscoreConcurrency, updateBoxscoreForGame);
      log(`Scoreboard updated: ${games.length} games (cron)`);
      return;
    }

    const now = Date.now();
    const staleIds = gameIds.filter((gameId) => {
      const cached = statusCache.get(gameId);
      if (!cached) return true;
      if (activeGameIds.has(gameId)) return false;
      return now - cached.checkedAt > CONFIG.statusRefreshMs;
    });

    throwIfCronBudgetExceeded("scoreboard_stale_boxscores");
    await runWithConcurrency(staleIds, CONFIG.boxscoreConcurrency, updateBoxscoreForGame);
    log(`Scoreboard updated: ${games.length} games, ${activeGameIds.size} active`);
  }, { season, date: today });
}

async function refreshRecentBoxscores() {
  const season = await getSeason();
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - CONFIG.boxscoreLookbackDays);
  const dateFrom = formatDateInTZ(CONFIG.timeZone, startDate);
  const dateTo = formatDateInTZ(CONFIG.timeZone, endDate);
  await withIngestionState("boxscores", async () => {
    let page = 1;
    const pageSize = 200;
    const gameIds = [];
    while (true) {
      throwIfCronBudgetExceeded("boxscores_page");
      const payload = await apiRequest(
        `/v1/games?season=${season}&date_from=${dateFrom}&date_to=${dateTo}&page=${page}&page_size=${pageSize}`
      );
      const rows = payload.data || [];
      for (const row of rows) {
        if (row && row.game_id) {
          gameIds.push(row.game_id);
        }
      }
      const nextPage = payload.meta?.pagination?.next;
      if (!nextPage) break;
      page = nextPage;
    }
    let totalPlayers = 0;
    throwIfCronBudgetExceeded("boxscores_updates");
    await runWithConcurrency(gameIds, CONFIG.boxscoreConcurrency, async (gameId) => {
      const result = await updateBoxscoreForGame(gameId);
      totalPlayers += result.playersCount || 0;
    });
    logUpsert("boxscores", gameIds.length, { date_from: dateFrom, date_to: dateTo });
    logUpsert("boxscore_players", totalPlayers, { date_from: dateFrom, date_to: dateTo });
  }, { season, date_from: dateFrom, date_to: dateTo });
}

async function refreshActiveGames() {
  if (activeGameIds.size === 0) return;
  await withIngestionState("live_games", async () => {
    const gameIds = Array.from(activeGameIds);
    await runWithConcurrency(gameIds, CONFIG.boxscoreConcurrency, updateBoxscoreForGame);
    log(`Live games refreshed: ${gameIds.length}`);
  }, { active: Array.from(activeGameIds) });
}

async function runWithConcurrency(items, limit, fn, { strict = false } = {}) {
  const queue = [...items];
  const errors = [];
  let circuitOpen = false;
  let budgetExceeded = false;
  const workers = new Array(Math.min(limit, queue.length)).fill(null).map(async () => {
    while (queue.length && !circuitOpen) {
      const item = queue.shift();
      if (item === undefined) return;
      try {
        throwIfCronBudgetExceeded("concurrency");
        await fn(item);
      } catch (error) {
        if (isCronBudgetError(error)) {
          if (!budgetExceeded) {
            log("Cron budget exceeded; halting task batch", { item });
          }
          budgetExceeded = true;
          circuitOpen = true;
          errors.push({ item, error: String(error) });
          return;
        }
        if (isCircuitOpenError(error)) {
          if (!circuitOpen) {
            log("API circuit open; halting task batch", { item });
          }
          circuitOpen = true;
          errors.push({ item, error: String(error) });
          return;
        }
        errors.push({ item, error: String(error) });
        log("Worker task failed", { item, error: String(error) });
      }
    }
  });
  await Promise.all(workers);
  if (budgetExceeded) {
    throw new CronBudgetError("Cron runtime budget exceeded");
  }
  if (strict && errors.length) {
    const e = new Error(`Concurrency batch had ${errors.length} failures`);
    e.details = errors.slice(0, 20);
    throw e;
  }
}


function scheduleTask(name, intervalMs, fn, runImmediately = true) {
  let inFlight = false;
  const run = async () => {
    if (inFlight) return;
    if (isCircuitOpen()) {
      log("API circuit open; skipping task", { task: name });
      return;
    }
    inFlight = true;
    try {
      await fn();
    } catch (error) {
      log(`${name} task failed`, String(error));
    } finally {
      inFlight = false;
    }
  };
  if (runImmediately) {
    run();
  }
  setInterval(run, intervalMs);
}

function startWorker() {
  try {
    validateConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  log("Worker starting", {
    apiBaseUrl: CONFIG.apiBaseUrl,
    timeZone: CONFIG.timeZone,
  });
}

async function runCronTask(entity, intervalMs, fn) {
  if (!(await shouldRun(entity, intervalMs))) {
    return;
  }
  if (isCircuitOpen()) {
    log("API circuit open; skipping cron task", { task: entity });
    return;
  }
  throwIfCronBudgetExceeded(`cron_task:${entity}`);
  try {
    await fn();
  } catch (error) {
    if (isCronBudgetError(error)) {
      throw error;
    }
    log(`${entity} task failed`, String(error));
  }
}

async function runCron() {
  const gate = await shouldStartCronRun();
  if (!gate.allowed) {
    return;
  }

  const runNumber = (gate.runs ?? 0) + 1;
  const windowLabel = gate.inWindow ? "in" : "out";
  const nowMs = Date.now();
  const nextRunAfter = computeNextRunAfter(gate.inWindow, nowMs);
  const cronCursor = {
    window: windowLabel,
    next_run_after: nextRunAfter,
  };
  await recordCronRunState("running", gate.date, runNumber, cronCursor, null);
  initCronBudget();

  let finalStatus = "ok";
  let errorMessage = null;
  try {
    await runCronTask("scoreboard", CONFIG.scoreboardIntervalMs, () =>
      refreshScoreboard({ mode: "cron" })
    );
    await runCronTask("games", CONFIG.gamesIntervalMs, refreshGames);
    await runCronTask("players", CONFIG.playersIntervalMs, refreshPlayers);
    await runCronTask("league_standings", CONFIG.standingsIntervalMs, refreshStandings);
    await runCronTask("player_awards", CONFIG.playerAwardsIntervalMs, refreshPlayerAwards);
    await runCronTask("player_season_stats", CONFIG.playerStatsIntervalMs, refreshPlayerSeasonStats);
    await runCronTask("team_advanced_stats", CONFIG.teamStatsIntervalMs, refreshTeamStats);
    await runCronTask("team_details", CONFIG.teamDetailsIntervalMs, refreshTeamDetails);
    await runCronTask("boxscores", CONFIG.boxscoreBackfillIntervalMs, refreshRecentBoxscores);
  } catch (error) {
    finalStatus = "failed";
    errorMessage = error instanceof Error ? error.message : String(error);
    if (isCronBudgetError(error)) {
      log("Cron budget exceeded; stopping remaining tasks");
    } else {
      log("Cron run failed", errorMessage);
    }
  } finally {
    if (cronBudget?.exceeded && finalStatus === "ok") {
      finalStatus = "failed";
      errorMessage = "Cron runtime budget exceeded";
    }
    await recordCronRunState(finalStatus, gate.date, runNumber, cronCursor, errorMessage);
    clearCronBudget();
  }
}

async function runLive() {
  scheduleTask("scoreboard", CONFIG.scoreboardIntervalMs, refreshScoreboard, true);
  scheduleTask("live-games", CONFIG.livePollIntervalMs, refreshActiveGames, true);
  scheduleTask("teams", CONFIG.teamsIntervalMs, refreshTeams, true);
  scheduleTask("players", CONFIG.playersIntervalMs, refreshPlayers, true);
  scheduleTask("standings", CONFIG.standingsIntervalMs, refreshStandings, true);
  scheduleTask("player-awards", CONFIG.playerAwardsIntervalMs, refreshPlayerAwards, true);
  scheduleTask("player-season-stats", CONFIG.playerStatsIntervalMs, refreshPlayerSeasonStats, true);
  scheduleTask("team-advanced-stats", CONFIG.teamStatsIntervalMs, refreshTeamStats, true);
  scheduleTask("team-details", CONFIG.teamDetailsIntervalMs, refreshTeamDetails, true);
  scheduleTask("boxscores-backfill", CONFIG.boxscoreBackfillIntervalMs, refreshRecentBoxscores, true);
}

if (require.main === module) {
  startWorker();
  if (CONFIG.workerMode === "live") {
    runLive();
  } else {
    runCron()
      .then(() => {
        log("Cron run complete");
      })
      .catch((error) => {
        console.error("Cron run failed", error);
        process.exitCode = 1;
      });
  }
}

module.exports = {
  CONFIG,
  startWorker,
  validateConfig,
  normalizeBaseUrl,
  parseBoolean,
  toText,
  seasonToYear,
  normalizeBooleanText,
  toPlayerId,
  toNumber,
  cacheKey,
  formatDateInTZ,
  getHourInTZ,
  getSeasonForDate,
  normalizeHour,
  isHourInWindow,
  normalizeConflictValue,
  isFinalStatus,
  isLiveStatus,
  parseSeasonList,
  normalizeSeasonList,
  seasonsMatch,
  mapTeamRow,
  mapPlayerRow,
  mapGameRow,
  applyRanks,
  computeRetryWaitMs,
  dedupeRowsForConflict,
  parseCursor,
  parseCronBudgetCursor,
  chunkArray,
};
