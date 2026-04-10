#!/usr/bin/env node
"use strict";

if (typeof fetch !== "function") {
  console.error("This worker requires Node.js 18+ (global fetch).");
  process.exit(1);
}

const { spawn } = require("child_process");
const { cache } = require("./cache");
const dns = require("dns");
const path = require("path");

// Prefer IPv4 to reduce intermittent `fetch failed` issues on dual-stack networks
// (observed in GitHub Actions runners for stats.nba.com).
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // Best-effort: older Node versions may not support this.
}

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

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, entry]) => entry !== undefined && entry !== null)
  );
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

function toInteger(value) {
  const numeric = toNumber(value);
  return numeric === null ? null : Math.trunc(numeric);
}

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const lowered = text.toLowerCase();
  if (["nan", "none", "n/a", "null"].includes(lowered)) {
    return null;
  }
  return text;
}

function toDateText(value) {
  const text = cleanText(value);
  if (!text) return null;
  return text.includes("T") ? text.split("T", 1)[0] : text;
}

function inferSeasonYear(value) {
  const text = cleanText(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return seasonToYear(getSeasonForDate(CONFIG.timeZone, parsed));
}

function buildSupportedSeasons({
  startYear = CONFIG.supportedSeasonStartYear,
  date = new Date(),
} = {}) {
  const currentYear = date.getUTCFullYear();
  const seasons = [];
  for (let year = startYear; year <= currentYear; year += 1) {
    seasons.push(`${year}-${String((year + 1) % 100).padStart(2, "0")}`);
  }
  return seasons;
}

const CONFIG = {
  workerMode: process.env.WORKER_MODE || "cron",
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SECRET_KEY,
  supabaseSchema: process.env.SUPABASE_SCHEMA || "public",
  supportedSeasonStartYear: Number(process.env.SUPPORTED_SEASON_START_YEAR || 1996),
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
  cronLiveBoxscoreLookbackDays: Number(
    process.env.CRON_LIVE_BOXSCORE_LOOKBACK_DAYS || 2
  ),
  cronLiveBoxscoreIntervalMs: Number(
    process.env.CRON_LIVE_BOXSCORE_INTERVAL_MS || 15 * 60 * 1000
  ),
  cronOffWindowLiveBoxscoreIntervalMs: Number(
    process.env.CRON_OFF_WINDOW_LIVE_BOXSCORE_INTERVAL_MS || 3 * 60 * 60 * 1000
  ),
  cronLiveGamesLookbackDays: Number(process.env.CRON_LIVE_GAMES_LOOKBACK_DAYS || 3),
  cronLiveGamesIntervalMs: Number(
    process.env.CRON_LIVE_GAMES_INTERVAL_MS || 15 * 60 * 1000
  ),
  cronOffWindowLiveGamesIntervalMs: Number(
    process.env.CRON_OFF_WINDOW_LIVE_GAMES_INTERVAL_MS || 3 * 60 * 60 * 1000
  ),
  cronMaintenanceMinRemainingMs: Number(
    process.env.CRON_MAINTENANCE_MIN_REMAINING_MS || 10 * 60 * 1000
  ),
  apiMinIntervalMs: Number(process.env.API_MIN_INTERVAL_MS || 250),
  apiRetryMax: Number(process.env.API_RETRY_MAX || 4),
  apiRetryBaseDelayMs: Number(process.env.API_RETRY_BASE_DELAY_MS || 750),
  statsRetryMax: Number(process.env.STATS_RETRY_MAX || process.env.API_RETRY_MAX || 4),
  statsTimeoutMs: Number(process.env.STATS_TIMEOUT_MS || 30000),
  statsTransport: process.env.STATS_TRANSPORT || "nba_api",
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
  cacheTtlPlayerStatsSec: Number(process.env.CACHE_TTL_PLAYER_STATS_SEC || 60 * 15),
  cacheTtlTeamStatsSec: Number(process.env.CACHE_TTL_TEAM_STATS_SEC || 60 * 60),
  cacheTtlTeamsSec: Number(process.env.CACHE_TTL_TEAMS_SEC || 60 * 60 * 24),
  cacheTtlTeamDetailsSec: Number(process.env.CACHE_TTL_TEAM_DETAILS_SEC || 60 * 60 * 24),
  cacheTtlPlayerAwardsSec: Number(process.env.CACHE_TTL_PLAYER_AWARDS_SEC || 60 * 60 * 24),
  cacheStaleTtlSec: Number(process.env.CACHE_STALE_TTL_SEC || 60 * 60 * 24 * 7),
};

function validateConfig() {
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
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

const LEAGUE_LEADER_STAT_CATEGORIES = [
  "PTS",
  "REB",
  "AST",
  "STL",
  "BLK",
  "TOV",
  "EFF",
  "MIN",
  "FG_PCT",
  "FG3_PCT",
  "FT_PCT",
];

const activeGameIds = new Set();
const statusCache = new Map();
let cachedSeason = null;
let cachedSeasonAt = 0;
let cachedSupportedSeasons = null;
let cachedSupportedSeasonsAt = 0;
let statsRequestQueue = Promise.resolve();
let lastStatsRequestAt = 0;
const cacheStats = {
  writes: 0,
  failures: 0,
  lastLogAt: 0,
};
let cronBudget = null;
let nbaApiBridge = null;
let nbaApiBridgeReady = null;
let nbaApiBridgeStdout = "";
let nbaApiBridgeRequestId = 0;
const nbaApiBridgePending = new Map();

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection", formatErrorForLog(reason, { includeStack: true }));
});

process.on("exit", () => {
  if (nbaApiBridge) {
    nbaApiBridge.kill();
  }
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

function logDbWrite(action, table, details) {
  log(`DB ${action}`, { table, ...details });
}

function formatErrorForLog(error, options = {}) {
  const { includeStack = false, maxCauseDepth = 1 } = options;
  const source = error && typeof error === "object" ? error : null;
  const details = compactObject({
    error: String(error),
    error_name: error instanceof Error ? error.name : null,
    error_message: error instanceof Error ? error.message : null,
    error_code: source?.code ?? null,
    error_errno: source?.errno ?? null,
    error_type: source?.type ?? null,
    error_syscall: source?.syscall ?? null,
    error_hostname: source?.hostname ?? null,
    error_address: source?.address ?? null,
    error_port: source?.port ?? null,
  });
  if (includeStack && error instanceof Error && error.stack) {
    details.error_stack = error.stack;
  }
  if (maxCauseDepth > 0 && source?.cause) {
    details.cause = formatErrorForLog(source.cause, {
      includeStack,
      maxCauseDepth: maxCauseDepth - 1,
    });
  }
  return details;
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
  teamDetails: (teamId) => cacheKey("team_details", teamId),
  teamHistory: (teamId, seasonType = "Regular Season", perMode = "Totals") =>
    cacheKey("team_history", teamId, seasonType, perMode),
  playerAwards: (playerId) => cacheKey("player_awards", playerId),
  playerInfo: (playerId) => cacheKey("player_info", playerId),
  playerStats: (
    season,
    seasonType = "Regular Season",
    measure = "Base",
    perMode = "PerGame"
  ) => cacheKey("player_stats", season, seasonType, measure, perMode, "all"),
};

const CachePatterns = {
  players: (season) => cacheKey("players", season, "*"),
  playerBio: (season) => cacheKey("player_bio", "*", season),
  playerStats: (season) => cacheKey("player_stats", season, "*"),
};

const InternalCacheKeys = {
  teamStats: (season, measure = "Base", perMode = "PerGame") =>
    `team_stats:${season}:${measure}:${perMode}`,
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
    const staleTtl = Math.max(ttlSeconds, CONFIG.cacheStaleTtlSec);
    await Promise.all([
      cache.set(key, payload, { ex: ttlSeconds }),
      cache.set(`${key}:stale`, payload, { ex: staleTtl }),
    ]);
    recordCacheWrite(true);
  } catch (error) {
    recordCacheWrite(false);
    log("Redis cache write failed", { key, ...formatErrorForLog(error) });
  }
}

async function deleteCacheKey(key) {
  if (!cache) return;
  try {
    await cache.del(key, `${key}:stale`);
  } catch (error) {
    log("Redis cache delete failed", { key, ...formatErrorForLog(error) });
  }
}

async function invalidateCachePattern(pattern) {
  if (!cache) return;
  const match = pattern.replace(/:+$/, "");
  try {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await cache.scan(cursor, {
        match: `${match}*`,
        count: 200,
      });
      cursor = String(nextCursor);
      if (Array.isArray(keys) && keys.length > 0) {
        await cache.del(...keys);
      }
    } while (cursor !== "0");
  } catch (error) {
    log("Redis cache invalidation failed", { pattern: match, ...formatErrorForLog(error) });
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

function formatStatsDateInTZ(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.month}/${lookup.day}/${lookup.year}`;
}

function toStatsDate(value, timeZone) {
  if (!value) return "";
  if (value instanceof Date) {
    return formatStatsDateInTZ(timeZone, value);
  }
  const text = String(value).trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split("-");
    return `${month}/${day}/${year}`;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return formatStatsDateInTZ(timeZone, parsed);
}

function normalizeGameDate(value, timeZone) {
  if (!value) return null;
  if (value instanceof Date) {
    return formatDateInTZ(timeZone, value);
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatDateInTZ(timeZone, parsed);
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

function parseMatchup(matchup) {
  const matchupUpper = String(matchup || "").toUpperCase();
  if (matchupUpper.includes(" VS. ")) {
    const [home, away] = matchupUpper.split(" VS. ", 2);
    return [home.trim(), away.trim()];
  }
  if (matchupUpper.includes(" @ ")) {
    const [away, home] = matchupUpper.split(" @ ", 2);
    return [home.trim(), away.trim()];
  }
  if (matchupUpper.includes(" AT ")) {
    const [away, home] = matchupUpper.split(" AT ", 2);
    return [home.trim(), away.trim()];
  }
  return null;
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

function normalizeActiveFlag(value) {
  const text = cleanText(value);
  if (!text) return null;
  const lowered = text.toLowerCase();
  if (["1", "true", "yes", "y", "on", "active"].includes(lowered)) {
    return "true";
  }
  if (["0", "false", "no", "n", "off", "inactive"].includes(lowered)) {
    return "false";
  }
  return normalizeBooleanText(text);
}

function mapTeamRow(team) {
  if (!team) return null;
  const teamId = team.team_id ?? team.id ?? team.TEAM_ID ?? team.teamId ?? null;
  if (teamId === null || teamId === undefined) return null;
  return {
    team_id: teamId,
    abbreviation: cleanText(team.abbreviation ?? team.ABBREVIATION ?? team.TEAM_ABBREVIATION),
    city: cleanText(team.city ?? team.CITY ?? team.TEAM_CITY),
    name: cleanText(team.name ?? team.NICKNAME ?? team.TEAM_NAME),
    conference: cleanText(team.conference ?? team.CONFERENCE),
    division: cleanText(team.division ?? team.DIVISION),
  };
}

function mapPlayerRow(player) {
  if (!player) return null;
  const playerId = toPlayerId(player.player_id ?? player.id ?? player.PERSON_ID);
  if (!playerId) return null;
  return {
    player_id: playerId,
    full_name: cleanText(
      player.full_name ?? player.DISPLAY_FIRST_LAST ?? player.PLAYER_NAME ?? player.name
    ),
    current_team_id: player.current_team_id ?? player.team_id ?? player.TEAM_ID ?? null,
    is_active: normalizeActiveFlag(player.is_active ?? player.ROSTERSTATUS),
  };
}

function mapGameRow(game, season) {
  if (!game) return null;
  const gameId = game.game_id ?? null;
  if (!gameId) return null;
  return {
    game_id: gameId,
    date: toText(game.date),
    start_time: toText(
      game.start_time ??
        game.start_time_utc ??
        game.start_time_est ??
        game.start_time_local ??
        game.game_time
    ),
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
  const season = cleanText(row.season ?? row.SEASON);
  const description = cleanText(row.description ?? row.DESCRIPTION);
  if (!resolvedPlayerId || !season || !description) return null;
  return {
    player_id: resolvedPlayerId,
    season,
    description,
    team: cleanText(row.team ?? row.TEAM),
    conference: cleanText(row.conference ?? row.CONFERENCE),
    award_type: cleanText(row.award_type ?? row.TYPE),
    subtype1: cleanText(row.subtype1 ?? row.SUBTYPE1),
    subtype2: cleanText(row.subtype2 ?? row.SUBTYPE2),
    subtype3: cleanText(row.subtype3 ?? row.SUBTYPE3),
    month: cleanText(row.month ?? row.MONTH),
    week: cleanText(row.week ?? row.WEEK),
    all_nba_team_number: toInteger(row.all_nba_team_number ?? row.ALL_NBA_TEAM_NUMBER),
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

function normalizeLeagueStanding(row, teamsById = new Map()) {
  if (!row) return null;
  const teamId = toInteger(row.team_id ?? row.TeamID ?? row.teamId);
  if (teamId === null) return null;
  const team = teamsById.get(teamId) || null;
  const teamCity = cleanText(row.team_city ?? row.TeamCity) ?? team?.city ?? null;
  const teamName = cleanText(row.team_name ?? row.TeamName) ?? team?.name ?? null;
  const teamSlug = cleanText(row.team_slug ?? row.TeamSlug);
  const teamAbbreviation =
    cleanText(row.team_abbreviation ?? row.TeamAbbreviation) ??
    team?.abbreviation ??
    (teamSlug ? teamSlug.toUpperCase() : null);

  return {
    team_id: teamId,
    team_name: teamName,
    team_city: teamCity,
    team_slug: teamSlug,
    team_abbreviation: teamAbbreviation,
    conference: cleanText(row.conference ?? row.Conference),
    conference_rank: toInteger(row.conference_rank ?? row.PlayoffRank ?? row.LeagueRank),
    division: cleanText(row.division ?? row.Division),
    division_rank: toInteger(row.division_rank ?? row.DivisionRank),
    wins: toInteger(row.wins ?? row.WINS),
    losses: toInteger(row.losses ?? row.LOSSES),
    win_pct: toNumber(row.win_pct ?? row.WinPCT),
    games_back: toNumber(row.games_back ?? row.ConferenceGamesBack),
    division_games_back: toNumber(row.division_games_back ?? row.DivisionGamesBack),
    record: cleanText(row.record ?? row.Record),
    home_record: cleanText(row.home_record ?? row.HOME),
    road_record: cleanText(row.road_record ?? row.ROAD),
    last_ten: cleanText(row.last_ten ?? row.L10),
    streak: cleanText(row.streak ?? row.strCurrentStreak ?? row.CurrentStreak),
  };
}

function normalizeServingTeamStatsRow(row, teamsById = new Map()) {
  if (!row) return null;
  const teamId = toInteger(row.team_id ?? row.TEAM_ID);
  if (teamId === null) return null;
  const team = teamsById.get(teamId) || null;
  return {
    team_id: teamId,
    team_abbreviation:
      cleanText(row.team_abbreviation ?? row.TEAM_ABBREVIATION) ?? team?.abbreviation ?? "UNK",
    team_name: cleanText(row.team_name ?? row.TEAM_NAME) ?? team?.name ?? "Unknown",
    games_played: toInteger(row.games_played ?? row.GP) ?? 0,
    wins: toInteger(row.wins ?? row.W) ?? 0,
    losses: toInteger(row.losses ?? row.L) ?? 0,
    win_pct: toNumber(row.win_pct ?? row.W_PCT) ?? 0,
    points: toNumber(row.points ?? row.PTS) ?? 0,
    field_goal_pct: toNumber(row.field_goal_pct ?? row.FG_PCT) ?? 0,
    rebounds: toNumber(row.rebounds ?? row.REB) ?? 0,
    assists: toNumber(row.assists ?? row.AST) ?? 0,
    steals: toNumber(row.steals ?? row.STL),
    blocks: toNumber(row.blocks ?? row.BLK),
    turnovers: toNumber(row.turnovers ?? row.TOV ?? row.TO),
    plus_minus: toNumber(row.plus_minus ?? row.PLUS_MINUS),
  };
}

function normalizePlayerInfoRow(row) {
  if (!row) return null;
  const playerId = toPlayerId(row.PERSON_ID ?? row.player_id);
  if (!playerId) return null;
  const firstName = cleanText(row.FIRST_NAME ?? row.first_name);
  const lastName = cleanText(row.LAST_NAME ?? row.last_name);
  const displayName =
    cleanText(row.DISPLAY_FIRST_LAST ?? row.display_name) ||
    [firstName, lastName].filter(Boolean).join(" ").trim() ||
    null;
  const birthdateRaw = cleanText(row.BIRTHDATE ?? row.birthdate);
  const birthdate = birthdateRaw ? birthdateRaw.split("T")[0] : null;
  return {
    player_id: playerId,
    first_name: firstName,
    last_name: lastName,
    display_name: displayName,
    position: cleanText(row.POSITION ?? row.position),
    jersey: cleanText(row.JERSEY ?? row.jersey),
    birthdate,
    school: cleanText(row.SCHOOL ?? row.school),
    country: cleanText(row.COUNTRY ?? row.country),
    season_experience: toInteger(row.SEASON_EXP ?? row.season_experience),
    roster_status: cleanText(row.ROSTERSTATUS ?? row.roster_status),
    from_year: toInteger(row.FROM_YEAR ?? row.from_year),
    to_year: toInteger(row.TO_YEAR ?? row.to_year),
    team_id: toInteger(row.TEAM_ID ?? row.team_id),
    team_name: cleanText(row.TEAM_NAME ?? row.team_name),
    team_abbreviation: cleanText(row.TEAM_ABBREVIATION ?? row.team_abbreviation),
    updated_at: new Date().toISOString(),
  };
}

function normalizePlayerStatsSnapshotRow(row) {
  if (!row) return null;
  const playerId = toInteger(row.PLAYER_ID ?? row.player_id ?? row.personId);
  if (playerId === null) return null;
  const playerName =
    cleanText(
      row.PLAYER_NAME ?? row.player_name ?? row.PLAYER ?? row.playerName ?? row.name ?? row.nameI
    ) || `Player ${playerId}`;
  return {
    player_id: playerId,
    player_name: playerName,
    team_id: toInteger(row.TEAM_ID ?? row.team_id ?? row.teamId),
    team_abbreviation: cleanText(
      row.TEAM_ABBREVIATION ?? row.TEAM ?? row.team_abbreviation ?? row.teamTricode
    ),
    points: toNumber(row.PTS ?? row.points) ?? 0,
    rebounds: toNumber(row.REB ?? row.rebounds) ?? 0,
    assists: toNumber(row.AST ?? row.assists) ?? 0,
    minutes: toNumber(row.MIN ?? row.minutes),
  };
}

function mapTeamHistoryRow(row, seasonType, perMode) {
  if (!row) return null;
  const teamId = toInteger(row.TEAM_ID ?? row.team_id);
  const season = cleanText(row.YEAR ?? row.season);
  if (teamId === null || !season) return null;
  const finalsResult = cleanText(row.NBA_FINALS_APPEARANCE ?? row.finals_result);
  return {
    season,
    team_id: teamId,
    season_type: seasonType,
    per_mode: perMode,
    team_city: cleanText(row.TEAM_CITY ?? row.team_city),
    team_name: cleanText(row.TEAM_NAME ?? row.team_name),
    games_played: toInteger(row.GP ?? row.games_played),
    wins: toInteger(row.WINS ?? row.wins),
    losses: toInteger(row.LOSSES ?? row.losses),
    win_pct: toNumber(row.WIN_PCT ?? row.win_pct),
    conference_rank: toInteger(row.CONF_RANK ?? row.conference_rank),
    division_rank: toInteger(row.DIV_RANK ?? row.division_rank),
    playoff_wins: toInteger(row.PO_WINS ?? row.playoff_wins),
    playoff_losses: toInteger(row.PO_LOSSES ?? row.playoff_losses),
    finals_result: finalsResult && finalsResult.toLowerCase() !== "n/a" ? finalsResult : null,
    points: toNumber(row.PTS ?? row.points),
    field_goal_pct: toNumber(row.FG_PCT ?? row.field_goal_pct),
    three_point_pct: toNumber(row.FG3_PCT ?? row.three_point_pct),
    updated_at: new Date().toISOString(),
  };
}

function mapLeagueLeaderRow(row, season, seasonType, perMode, statCategory) {
  if (!row) return null;
  const playerId = toPlayerId(row.PLAYER_ID ?? row.player_id);
  const rank = toInteger(row.RANK ?? row.rank);
  if (!playerId || rank === null) return null;
  const statValue =
    toNumber(
      row[statCategory] ??
        row.stat_value ??
        row.PTS ??
        row.REB ??
        row.AST ??
        row.STL ??
        row.BLK ??
        row.TOV ??
        row.EFF ??
        row.MIN ??
        row.FG_PCT ??
        row.FG3_PCT ??
        row.FT_PCT
    ) ?? 0;
  return {
    season,
    season_type: seasonType,
    per_mode: perMode,
    stat_category: statCategory,
    rank,
    player_id: playerId,
    player_name: cleanText(row.PLAYER ?? row.player_name),
    team_id: toInteger(row.TEAM_ID ?? row.team_id),
    team_abbreviation: cleanText(row.TEAM ?? row.team_abbreviation),
    games_played: toInteger(row.GP ?? row.games_played),
    minutes: toNumber(row.MIN ?? row.minutes),
    points: toNumber(row.PTS ?? row.points),
    rebounds: toNumber(row.REB ?? row.rebounds),
    assists: toNumber(row.AST ?? row.assists),
    steals: toNumber(row.STL ?? row.steals),
    blocks: toNumber(row.BLK ?? row.blocks),
    turnovers: toNumber(row.TOV ?? row.turnovers),
    efficiency: toNumber(row.EFF ?? row.efficiency),
    stat_value: statValue,
    updated_at: new Date().toISOString(),
  };
}

function formatAwardHistory(rows) {
  return (rows || [])
    .map((row) => {
      const year = cleanText(row.YEARAWARDED ?? row.YEAR);
      const opponent = cleanText(row.OPPOSITETEAM);
      if (!year) return null;
      return opponent ? `${year} vs ${opponent}` : year;
    })
    .filter(Boolean);
}

function normalizeTeamDetailsPayload(payload, teamId) {
  const background = extractResultSetRows(payload, "TeamBackground");
  const championships = extractResultSetRows(payload, "TeamAwardsChampionships");
  const conferenceTitles = extractResultSetRows(payload, "TeamAwardsConf");
  const divisionTitles = extractResultSetRows(payload, "TeamAwardsDiv");
  const hallOfFamers = extractResultSetRows(payload, "TeamHof");
  const retired = extractResultSetRows(payload, "TeamRetired");
  const social = extractResultSetRows(payload, "TeamSocialSites");
  const info = background[0] || {};

  return {
    team_id: toInteger(info.TEAM_ID) ?? teamId,
    abbreviation: cleanText(info.ABBREVIATION),
    nickname: cleanText(info.NICKNAME),
    city: cleanText(info.CITY),
    year_founded: toInteger(info.YEARFOUNDED),
    arena: cleanText(info.ARENA),
    arena_capacity: toInteger(info.ARENACAPACITY),
    owner: cleanText(info.OWNER),
    general_manager: cleanText(info.GENERALMANAGER),
    head_coach: cleanText(info.HEADCOACH),
    dleague_affiliation: cleanText(info.DLEAGUEAFFILIATION),
    championships: formatAwardHistory(championships),
    conference_titles: formatAwardHistory(conferenceTitles),
    division_titles: formatAwardHistory(divisionTitles),
    hall_of_famers: hallOfFamers.map((row) => cleanText(row.PLAYER)).filter(Boolean),
    retired_numbers: retired
      .map((row) => {
        const player = cleanText(row.PLAYER);
        const jersey = cleanText(row.JERSEY);
        if (!player) return null;
        return jersey ? `${player} #${jersey}` : player;
      })
      .filter(Boolean),
    social_sites: Object.fromEntries(
      social
        .map((row) => [cleanText(row.ACCOUNTTYPE)?.toLowerCase(), cleanText(row.WEBSITE_LINK)])
        .filter(([accountType, url]) => accountType && url)
    ),
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

function parseStatsEndpointUrl(url) {
  const parsed = new URL(url);
  const endpoint = parsed.pathname.split("/").filter(Boolean).at(-1);
  if (!endpoint) {
    throw new Error(`Unable to determine stats endpoint from URL: ${url}`);
  }
  return {
    endpoint,
    parameters: Object.fromEntries(parsed.searchParams.entries()),
  };
}

function rejectPendingNbaApiBridgeRequests(error) {
  const pending = Array.from(nbaApiBridgePending.values());
  nbaApiBridgePending.clear();
  pending.forEach(({ reject }) => reject(error));
}

function handleNbaApiBridgeLine(line) {
  let message = null;
  try {
    message = JSON.parse(line);
  } catch (error) {
    log("nba_api bridge emitted invalid JSON", {
      line,
      ...formatErrorForLog(error),
    });
    return;
  }
  if (message.ready) {
    return;
  }
  const pending = nbaApiBridgePending.get(message.id);
  if (!pending) {
    return;
  }
  nbaApiBridgePending.delete(message.id);
  if (message.ok) {
    pending.resolve(message.data);
  } else {
    pending.reject(new Error(message.error || "nba_api bridge request failed"));
  }
}

async function ensureNbaApiBridge() {
  if (nbaApiBridge && nbaApiBridgeReady) {
    return nbaApiBridgeReady;
  }
  const scriptPath = path.join(__dirname, "nba_api_bridge.py");
  nbaApiBridgeStdout = "";
  nbaApiBridge = spawn("python3", [scriptPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  nbaApiBridge.stdout.setEncoding("utf8");
  nbaApiBridge.stderr.setEncoding("utf8");
  nbaApiBridgeReady = new Promise((resolve, reject) => {
    let settled = false;
    let stderr = "";

    const settleError = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
      rejectPendingNbaApiBridgeRequests(error);
      nbaApiBridge = null;
      nbaApiBridgeReady = null;
    };

    nbaApiBridge.stdout.on("data", (chunk) => {
      nbaApiBridgeStdout += chunk;
      let newlineIndex = nbaApiBridgeStdout.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = nbaApiBridgeStdout.slice(0, newlineIndex).trim();
        nbaApiBridgeStdout = nbaApiBridgeStdout.slice(newlineIndex + 1);
        if (line) {
          if (!settled) {
            try {
              const message = JSON.parse(line);
              if (message.ready) {
                settled = true;
                resolve();
              } else {
                handleNbaApiBridgeLine(line);
              }
            } catch (error) {
              settleError(
                new Error(`nba_api bridge startup produced invalid output: ${line}`)
              );
            }
          } else {
            handleNbaApiBridgeLine(line);
          }
        }
        newlineIndex = nbaApiBridgeStdout.indexOf("\n");
      }
    });

    nbaApiBridge.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    nbaApiBridge.once("error", (error) => {
      settleError(error);
    });

    nbaApiBridge.once("exit", (code, signal) => {
      const details = compactObject({
        code,
        signal,
        stderr: stderr.trim() || null,
      });
      const message = `nba_api bridge exited unexpectedly: ${JSON.stringify(details)}`;
      settleError(new Error(message));
    });
  });
  return nbaApiBridgeReady;
}

async function nbaApiStatsRequest(url) {
  return nbaApiBridgeRequest({
    op: "stats_url",
    url,
    timeout_ms: CONFIG.statsTimeoutMs,
  });
}

async function nbaApiBridgeRequest(payload) {
  await ensureNbaApiBridge();
  if (!nbaApiBridge) {
    throw new Error("nba_api bridge unavailable");
  }
  const requestId = ++nbaApiBridgeRequestId;
  return new Promise((resolve, reject) => {
    nbaApiBridgePending.set(requestId, { resolve, reject });
    const message = {
      ...payload,
      id: requestId,
    };
    try {
      nbaApiBridge.stdin.write(`${JSON.stringify(message)}\n`);
    } catch (error) {
      nbaApiBridgePending.delete(requestId);
      reject(error);
    }
  });
}

async function statsRequestWithRetry(url) {
  let attempt = 0;
  let delay = CONFIG.apiRetryBaseDelayMs;
  const maxAttempts = Number.isFinite(CONFIG.statsRetryMax)
    ? CONFIG.statsRetryMax
    : CONFIG.apiRetryMax;
  while (attempt <= maxAttempts) {
    throwIfCronBudgetExceeded("stats_request");
    try {
      if (CONFIG.statsTransport === "fetch") {
        const response = await fetch(url, {
          headers: NBA_STATS_HEADERS,
          signal:
            typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
              ? AbortSignal.timeout(CONFIG.statsTimeoutMs)
              : undefined,
        });
        if (response.ok) {
          return response.json();
        }
        const body = await response.text();
        throw new Error(`NBA stats ${response.status} (${url}): ${body}`);
      }
      return await nbaApiStatsRequest(url);
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw new Error(`NBA stats request failed (${url}): ${String(error)}`);
      }
      const waitMs = computeRetryWaitMs(delay);
      log("NBA stats request failed; backing off", {
        url,
        attempt: attempt + 1,
        max_attempts: maxAttempts + 1,
        wait_ms: waitMs,
        ...formatErrorForLog(error),
      });
      await sleep(waitMs);
      delay *= 2;
      attempt += 1;
      continue;
    }
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
  logDbWrite("insert", table, { count: rows.length });
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
    log("Supabase insert failed", {
      table,
      count: Array.isArray(rows) ? rows.length : 0,
      ...formatErrorForLog(error),
    });
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
  logDbWrite("delete", table, { filters: filters || {} });
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
    log("Supabase delete failed", {
      table,
      filters,
      ...formatErrorForLog(error),
    });
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

function isMissingRpcFunctionError(error) {
  const message = String(error || "");
  return (
    message.includes("\"code\":\"PGRST202\"") ||
    message.includes("Could not find the function") ||
    message.includes("Searched for the function")
  );
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
  logDbWrite("upsert", table, {
    count: payload.length,
    on_conflict: onConflict || null,
  });
}

async function supabaseRpc(functionName, payload = {}) {
  const url = new URL(`${CONFIG.supabaseUrl}/rest/v1/rpc/${functionName}`);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      apikey: CONFIG.supabaseKey,
      Authorization: `Bearer ${CONFIG.supabaseKey}`,
      "Content-Type": "application/json",
      "Accept-Profile": CONFIG.supabaseSchema,
      "Content-Profile": CONFIG.supabaseSchema,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase rpc ${functionName} failed: ${response.status} ${body}`);
  }
  logDbWrite("rpc", functionName, {
    keys: Object.keys(payload || {}),
  });
  if (response.status === 204) {
    return null;
  }
  return response.json();
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
    log("Supabase upsert failed", {
      table,
      on_conflict: onConflict || null,
      count: Array.isArray(rows) ? rows.length : 0,
      ...formatErrorForLog(error),
    });
    if (recordState) {
      await updateIngestionState(table, "failed", cursor, message);
    }
    throw error;
  }
}

async function writeApiSnapshot(cacheKeyValue, payload) {
  await supabaseUpsert(
    "api_snapshots",
    [
      {
        cache_key: cacheKeyValue,
        payload: JSON.stringify(payload),
        updated_at: new Date().toISOString(),
      },
    ],
    "cache_key",
    { recordState: false }
  );
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

function shouldRunMaintenanceTask(task) {
  const remaining = cronRemainingMs();
  const minRemaining = CONFIG.cronMaintenanceMinRemainingMs;
  if (!Number.isFinite(minRemaining) || minRemaining <= 0) return true;
  if (remaining !== null && remaining < minRemaining) {
    log("Skipping maintenance task; low cron budget", {
      task,
      remaining_ms: remaining,
      min_remaining_ms: minRemaining,
    });
    return false;
  }
  return true;
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

async function shouldRun(entity, intervalMs, options = {}) {
  const logSkip = options.logSkip === true;
  const state = await getIngestionState(entity);
  if (!state || !state.last_success_at) {
    return true;
  }
  const lastSuccess = Date.parse(state.last_success_at);
  if (Number.isNaN(lastSuccess)) {
    return true;
  }
  const now = Date.now();
  const minInterval =
    CONFIG.workerMode === "cron"
      ? Math.max(intervalMs, CONFIG.cronMinIntervalMs)
      : intervalMs;
  const allowed = now - lastSuccess >= minInterval;
  if (!allowed && logSkip) {
    log("Cron task interval not reached; skipping", {
      task: entity,
      last_success_at: state.last_success_at,
      min_interval_ms: minInterval,
      elapsed_ms: now - lastSuccess,
    });
  }
  return allowed;
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
  const seasons = buildSupportedSeasons();
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

async function fetchCommonTeamYears() {
  const url = new URL("https://stats.nba.com/stats/commonteamyears");
  url.searchParams.set("LeagueID", "00");
  const payload = await statsRequest(url.toString());
  return extractResultSetRows(payload, "TeamYears");
}

async function fetchFranchiseHistory() {
  const url = new URL("https://stats.nba.com/stats/franchisehistory");
  url.searchParams.set("LeagueID", "00");
  const payload = await statsRequest(url.toString());
  return extractResultSetRows(payload, "FranchiseHistory");
}

async function fetchStaticPlayers() {
  const rows = await nbaApiBridgeRequest({ op: "static_players" });
  return (rows || []).map((row) => ({
    PERSON_ID: row.id,
    DISPLAY_FIRST_LAST: row.full_name,
    FIRST_NAME: row.first_name,
    LAST_NAME: row.last_name,
    ROSTERSTATUS: row.is_active ? "Active" : "Inactive",
  }));
}

async function fetchCommonAllPlayers(season) {
  try {
    const players = await fetchStaticPlayers();
    if (players.length) {
      return players;
    }
  } catch (error) {
    log("Static nba_api player directory fetch failed; falling back to stats endpoint", {
      season,
      ...formatErrorForLog(error),
    });
  }
  const url = new URL("https://stats.nba.com/stats/commonallplayers");
  url.searchParams.set("IsOnlyCurrentSeason", "0");
  url.searchParams.set("LeagueID", "00");
  url.searchParams.set("Season", season);
  const payload = await statsRequest(url.toString());
  return extractResultSetRows(payload, "CommonAllPlayers");
}

async function fetchLeagueStandingsRows(season, seasonType = "Regular Season") {
  const url = new URL("https://stats.nba.com/stats/leaguestandingsv3");
  url.searchParams.set("LeagueID", "00");
  url.searchParams.set("Season", season);
  url.searchParams.set("SeasonType", seasonType);
  const payload = await statsRequest(url.toString());
  return extractResultSetRows(payload, "Standings");
}

async function fetchTeamDetailsPayload(teamId) {
  const url = new URL("https://stats.nba.com/stats/teamdetails");
  url.searchParams.set("TeamID", String(teamId));
  return statsRequest(url.toString());
}

async function fetchPlayerAwardsRows(playerId) {
  const url = new URL("https://stats.nba.com/stats/playerawards");
  url.searchParams.set("PlayerID", String(playerId));
  const payload = await statsRequest(url.toString());
  return extractResultSetRows(payload, "PlayerAwards");
}

async function fetchCommonPlayerInfoRows(playerId) {
  const url = new URL("https://stats.nba.com/stats/commonplayerinfo");
  url.searchParams.set("PlayerID", String(playerId));
  const payload = await statsRequest(url.toString());
  return extractResultSetRows(payload, "CommonPlayerInfo");
}

async function fetchTeamYearByYearStatsRows(
  teamId,
  seasonType = "Regular Season",
  perMode = "Totals"
) {
  const url = new URL("https://stats.nba.com/stats/teamyearbyyearstats");
  url.searchParams.set("TeamID", String(teamId));
  url.searchParams.set("LeagueID", "00");
  url.searchParams.set("SeasonType", seasonType);
  url.searchParams.set("PerMode", perMode);
  const payload = await statsRequest(url.toString());
  return extractResultSetRows(payload, "TeamStats");
}

async function fetchLeagueLeadersRows(
  season,
  seasonType = "Regular Season",
  perMode = "PerGame",
  statCategory = "PTS"
) {
  const url = new URL("https://stats.nba.com/stats/leagueleaders");
  url.searchParams.set("LeagueID", "00");
  url.searchParams.set("Season", season);
  url.searchParams.set("SeasonType", seasonType);
  url.searchParams.set("PerMode", perMode);
  url.searchParams.set("StatCategory", statCategory);
  const payload = await statsRequest(url.toString());
  return extractResultSetRows(payload, "LeagueLeaders");
}

async function fetchStaticTeams() {
  const rows = await nbaApiBridgeRequest({ op: "static_teams" });
  return (rows || []).map((row) => ({
    id: row.id,
    team_id: row.id,
    abbreviation: row.abbreviation,
    city: row.city,
    name: row.nickname || row.full_name,
    conference: null,
    division: null,
  }));
}

async function fetchTeamsForSeason(season) {
  try {
    const teams = await fetchStaticTeams();
    if (teams.length) {
      return teams;
    }
  } catch (error) {
    log("Static nba_api team directory fetch failed; falling back to stats endpoints", {
      season,
      ...formatErrorForLog(error),
    });
  }
  const seasonYear = seasonToYear(season);
  const [teamYears, historyRows] = await Promise.all([
    fetchCommonTeamYears(),
    fetchFranchiseHistory(),
  ]);
  const historyByTeamId = new Map();
  for (const row of historyRows) {
    const teamId = toInteger(row.TEAM_ID);
    if (teamId === null) continue;
    const existing = historyByTeamId.get(teamId);
    const nextEndYear = toInteger(row.END_YEAR) ?? -1;
    const existingEndYear = existing ? toInteger(existing.END_YEAR) ?? -1 : -1;
    if (!existing || nextEndYear >= existingEndYear) {
      historyByTeamId.set(teamId, row);
    }
  }

  return teamYears
    .filter((row) => {
      if (seasonYear === null) return true;
      const minYear = toInteger(row.MIN_YEAR);
      const maxYear = toInteger(row.MAX_YEAR);
      return (minYear === null || seasonYear >= minYear) && (maxYear === null || seasonYear <= maxYear);
    })
    .map((row) => {
      const teamId = toInteger(row.TEAM_ID);
      if (teamId === null) return null;
      const history = historyByTeamId.get(teamId) || {};
      return {
        id: teamId,
        team_id: teamId,
        abbreviation: cleanText(row.ABBREVIATION),
        city: cleanText(history.TEAM_CITY),
        name: cleanText(history.TEAM_NAME),
        conference: null,
        division: null,
      };
    })
    .filter(Boolean);
}

function normalizeGameFinderRows(rows, season) {
  const games = new Map();
  for (const row of rows || []) {
    const gameId = row.GAME_ID ?? row.game_id;
    if (!gameId) continue;
    const gameDate = row.GAME_DATE ?? row.GAME_DATE_EST ?? row.game_date;
    const dateText = normalizeGameDate(gameDate, CONFIG.timeZone);
    if (!dateText) continue;
    const matchup = row.MATCHUP ?? row.matchup ?? "";
    const teamAbbrRaw = row.TEAM_ABBREVIATION ?? row.team_abbreviation ?? row.TEAM_NAME ?? "";
    const teamAbbr = String(teamAbbrRaw).trim().toUpperCase().split(" ").slice(-1)[0] || "";
    const parsed = parseMatchup(matchup);
    let isHome = null;
    if (parsed && teamAbbr) {
      const [homeAbbr, awayAbbr] = parsed;
      if (teamAbbr === homeAbbr) isHome = true;
      if (teamAbbr === awayAbbr) isHome = false;
    }
    if (isHome === null) {
      const matchupUpper = String(matchup).toUpperCase();
      if (matchupUpper.includes(" VS. ") || matchupUpper.includes(" VS ")) {
        isHome = true;
      } else if (matchupUpper.includes(" @ ") || matchupUpper.includes(" AT ")) {
        isHome = false;
      }
    }
    if (isHome === null) continue;
    const teamId = toNumber(row.TEAM_ID ?? row.team_id);
    if (teamId === null) continue;
    const teamName =
      row.TEAM_NAME ?? row.team_name ?? row.TEAM_ABBREVIATION ?? row.team_abbreviation ?? "";
    const points = toNumber(row.PTS ?? row.points) ?? 0;
    const entry =
      games.get(gameId) ||
      (() => {
        const next = {
          game_id: gameId,
          date: dateText,
          start_time: null,
          home_team_id: null,
          home_team_name: null,
          home_team_score: null,
          away_team_id: null,
          away_team_name: null,
          away_team_score: null,
          season: season ?? null,
        };
        games.set(gameId, next);
        return next;
      })();
    if (isHome) {
      entry.home_team_id = teamId;
      entry.home_team_name = teamName;
      entry.home_team_score = points;
    } else {
      entry.away_team_id = teamId;
      entry.away_team_name = teamName;
      entry.away_team_score = points;
    }
  }
  return Array.from(games.values()).filter(
    (entry) => entry.home_team_id !== null && entry.away_team_id !== null
  );
}

function normalizeLiveScoreboardGame(game, season) {
  const homeTeam = game?.homeTeam || {};
  const awayTeam = game?.awayTeam || {};
  const gameDate =
    normalizeGameDate(game?.gameEt || game?.gameTimeUTC, CONFIG.timeZone) ||
    formatDateInTZ(CONFIG.timeZone);
  return {
    game_id: cleanText(game?.gameId),
    date: gameDate,
    start_time: toText(game?.gameTimeUTC || game?.gameEt),
    home_team_id: toInteger(homeTeam.teamId),
    home_team_name: cleanText(homeTeam.teamName),
    home_team_score: toInteger(homeTeam.score) ?? 0,
    away_team_id: toInteger(awayTeam.teamId),
    away_team_name: cleanText(awayTeam.teamName),
    away_team_score: toInteger(awayTeam.score) ?? 0,
    season,
    status: cleanText(game?.gameStatusText),
  };
}

async function fetchLiveScoreboardGames(season) {
  const payload = await nbaApiBridgeRequest({ op: "live_scoreboard" });
  const games = (payload?.scoreboard?.games || [])
    .map((game) => normalizeLiveScoreboardGame(game, season))
    .filter((row) => row.game_id && row.home_team_id !== null && row.away_team_id !== null);
  return games;
}

async function fetchGamesFromStats(season, { dateFrom, dateTo } = {}) {
  const today = formatDateInTZ(CONFIG.timeZone);
  if (dateFrom && dateTo && dateFrom === today && dateTo === today) {
    try {
      return await fetchLiveScoreboardGames(season);
    } catch (error) {
      log("nba_api live scoreboard fetch failed; falling back to stats endpoint", {
        season,
        date: today,
        ...formatErrorForLog(error),
      });
    }
  }
  const url = new URL("https://stats.nba.com/stats/leaguegamefinder");
  const params = {
    LeagueID: "00",
    PlayerOrTeam: "T",
    Season: season,
    SeasonType: "Regular Season",
    DateFrom: toStatsDate(dateFrom, CONFIG.timeZone),
    DateTo: toStatsDate(dateTo, CONFIG.timeZone),
  };
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, String(value ?? ""));
  });
  const payload = await statsRequest(url.toString());
  const rows = extractResultSetRows(payload, "LeagueGameFinder");
  return normalizeGameFinderRows(rows, season);
}

async function fetchGames(season, { dateFrom, dateTo } = {}) {
  return fetchGamesFromStats(season, { dateFrom, dateTo });
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
  return fetchGames(season);
}

async function loadStoredGamesForSeason(season) {
  const seasonYear = seasonToYear(season);
  const query = {
    select:
      "game_id,date,start_time,home_team_id,home_team_name,home_team_score,away_team_id,away_team_name,away_team_score,season",
  };
  if (seasonYear !== null && seasonYear !== undefined) {
    query.season = `eq.${seasonYear}`;
  }
  return supabaseSelectAll("games", query);
}

function filterGamesByDateRange(rows, dateFrom, dateTo) {
  return (rows || []).filter((row) => {
    const gameDate = normalizeGameDate(row?.date, CONFIG.timeZone);
    if (!gameDate) return false;
    if (dateFrom && gameDate < dateFrom) return false;
    if (dateTo && gameDate > dateTo) return false;
    return true;
  });
}

async function fetchGamesForRecentWindow(season, { dateFrom, dateTo } = {}) {
  const merged = new Map();
  try {
    const storedGames = await loadStoredGamesForSeason(season);
    for (const game of filterGamesByDateRange(storedGames, dateFrom, dateTo)) {
      if (game?.game_id) {
        merged.set(game.game_id, game);
      }
    }
  } catch (error) {
    log("Stored games fetch failed; falling back to upstream for recent window", {
      season,
      date_from: dateFrom ?? null,
      date_to: dateTo ?? null,
      ...formatErrorForLog(error),
    });
  }

  const today = formatDateInTZ(CONFIG.timeZone);
  if ((!dateFrom || dateFrom <= today) && (!dateTo || dateTo >= today)) {
    try {
      const liveGames = await fetchLiveScoreboardGames(season);
      for (const game of liveGames) {
        if (game?.game_id) {
          merged.set(game.game_id, game);
        }
      }
    } catch (error) {
      log("Live scoreboard fetch failed during recent window load", {
        season,
        date_from: dateFrom ?? null,
        date_to: dateTo ?? null,
        ...formatErrorForLog(error),
      });
    }
  }

  if (merged.size > 0) {
    return Array.from(merged.values());
  }

  return fetchGames(season, { dateFrom, dateTo });
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

function normalizeAdvancedBoxscorePlayerRow(row) {
  if (!row || typeof row !== "object") return null;
  const pick = (...keys) => {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== null) {
        return row[key];
      }
    }
    return null;
  };
  const playerId = toPlayerId(pick("PLAYER_ID", "personId", "player_id"));
  if (!playerId) return null;
  const firstName = toText(pick("firstName", "FIRST_NAME"));
  const familyName = toText(pick("familyName", "LAST_NAME"));
  const fallbackName = [firstName, familyName].filter(Boolean).join(" ").trim();
  return {
    player_id: playerId,
    player_name: toText(pick("PLAYER_NAME", "playerName", "nameI")) || fallbackName || null,
    team_id: toNumber(pick("TEAM_ID", "teamId")),
    team_abbreviation: toText(pick("TEAM_ABBREVIATION", "teamTricode", "teamAbbreviation")),
    minutes: toText(pick("MIN", "minutes")),
    offensive_rating: toNumber(
      pick("OFF_RATING", "E_OFF_RATING", "offensiveRating", "estimatedOffensiveRating")
    ),
    defensive_rating: toNumber(
      pick("DEF_RATING", "E_DEF_RATING", "defensiveRating", "estimatedDefensiveRating")
    ),
    net_rating: toNumber(pick("NET_RATING", "E_NET_RATING", "netRating", "estimatedNetRating")),
    usage_pct: toNumber(
      pick("USG_PCT", "E_USG_PCT", "usagePercentage", "estimatedUsagePercentage")
    ),
    true_shooting_pct: toNumber(pick("TS_PCT", "trueShootingPercentage")),
    effective_fg_pct: toNumber(pick("EFG_PCT", "effectiveFieldGoalPercentage")),
    assist_pct: toNumber(pick("AST_PCT", "assistPercentage")),
    assist_to_turnover: toNumber(pick("AST_TOV", "assistToTurnover")),
    rebound_pct: toNumber(pick("REB_PCT", "reboundPercentage")),
    offensive_rebound_pct: toNumber(pick("OREB_PCT", "offensiveReboundPercentage")),
    defensive_rebound_pct: toNumber(pick("DREB_PCT", "defensiveReboundPercentage")),
    pace: toNumber(pick("PACE", "E_PACE", "pace", "estimatedPace")),
    pace_per40: toNumber(pick("PACE_PER40", "pacePer40")),
    possessions: toNumber(pick("POSS", "possessions")),
    pie: toNumber(pick("PIE", "pie")),
  };
}

async function fetchBoxscoreAdvancedPlayers(gameId) {
  const loadRows = async (endpoint, includeLeagueId) => {
    const url = new URL(`https://stats.nba.com/stats/${endpoint}`);
    url.searchParams.set("GameID", gameId);
    url.searchParams.set("StartPeriod", "0");
    url.searchParams.set("EndPeriod", "0");
    url.searchParams.set("StartRange", "0");
    url.searchParams.set("EndRange", "0");
    url.searchParams.set("RangeType", "0");
    if (includeLeagueId) {
      url.searchParams.set("LeagueID", "00");
    }
    const payload = await statsRequest(url.toString());
    return extractResultSetRows(payload, "PlayerStats");
  };

  let rows = await loadRows("boxscoreadvancedv2", true);
  if (!rows.length) {
    rows = await loadRows("boxscoreadvancedv3", false);
  }
  const byPlayer = new Map();
  for (const row of rows) {
    const normalized = normalizeAdvancedBoxscorePlayerRow(row);
    if (!normalized || !normalized.player_id) continue;
    byPlayer.set(normalized.player_id, normalized);
  }
  return Array.from(byPlayer.values());
}

async function fetchLeagueDashPlayerStats(
  season,
  seasonType = "Regular Season",
  measureType = "Base",
  perMode = "PerGame"
) {
  const url = new URL("https://stats.nba.com/stats/leaguedashplayerstats");
  const params = {
    Season: season,
    SeasonType: seasonType,
    PerMode: perMode,
    MeasureType: measureType,
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

async function fetchLeagueDashTeamStats(season, measureType, perMode = "PerGame") {
  const url = new URL("https://stats.nba.com/stats/leaguedashteamstats");
  const params = {
    Season: season,
    SeasonType: "Regular Season",
    PerMode: perMode,
    MeasureType: measureType,
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
    ShotClockRange: "",
    DistanceRange: "",
  };
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });
  const payload = await statsRequest(url.toString());
  return extractResultSetRows(payload, "LeagueDashTeamStats");
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
  throwIfCronBudgetExceeded("players_page");
  const rows = await fetchCommonAllPlayers(season);
  const players = [];
  for (const row of rows) {
    const playerId = toPlayerId(row.PERSON_ID ?? row.player_id ?? row.id);
    if (!playerId) continue;
    if (activeOnly && normalizeActiveFlag(row.ROSTERSTATUS) !== "true") {
      continue;
    }
    players.push(playerId);
    if (maxPlayers && players.length >= maxPlayers) {
      break;
    }
  }
  return players;
}

async function refreshTeams() {
  const season = await getSeason();
  await withIngestionState("teams", async () => {
    const teams = await fetchTeamsForSeason(season);
    const rows = teams.map(mapTeamRow).filter(Boolean);
    await supabaseUpsert("teams", rows, "team_id");
    await writeCache(CacheKeys.teams(season), teams, CONFIG.cacheTtlTeamsSec);
    logUpsert("teams", rows.length, { season });
  }, { season });
}

async function refreshGames() {
  const seasons = await getSeasonsToSync();
  await withIngestionState("games", async () => {
    for (const season of seasons) {
      throwIfCronBudgetExceeded("games_season");
      const games = await fetchGames(season);
      const rows = games.map((row) => mapGameRow(row, season)).filter(Boolean);
      let total = 0;
      if (rows.length) {
        await supabaseUpsert("games", rows, "game_id");
        total += rows.length;
      }
      logUpsert("games", total, { season });
    }
  }, { seasons });
}

async function refreshPlayersForSeason(season) {
  throwIfCronBudgetExceeded("players_page");
  const players = await fetchCommonAllPlayers(season);
  const rows = players.map(mapPlayerRow).filter(Boolean);
  if (rows.length) {
    await supabaseUpsert("players", rows, "player_id");
  }
  await invalidateCachePattern(CachePatterns.players(season));
  logUpsert("players", rows.length, { season });
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

async function refreshPlayerBioStatsForSeason(season) {
  const seasonType = "Regular Season";
  const bioRows = await fetchLeagueDashPlayerBioStats(season, seasonType);
  const updates = (bioRows || []).map(mapPlayerBioRow).filter(Boolean);
  if (updates.length) {
    await supabaseUpsert("players", updates, "player_id");
  }
  await invalidateCachePattern(CachePatterns.playerBio(season));
  logUpsert("players_bio", updates.length, { season });
}

async function refreshPlayerBioStats() {
  const seasons = await getSeasonsToSync();
  await withIngestionState("players_bio", async () => {
    const errors = [];
    for (const season of seasons) {
      throwIfCronBudgetExceeded("players_bio_season");
      try {
        await refreshPlayerBioStatsForSeason(season);
      } catch (error) {
        errors.push({ season, error: String(error) });
        log("players_bio season failed", { season, ...formatErrorForLog(error) });
      }
    }
    if (errors.length) {
      throw new Error(`players_bio failed for ${errors.length} season(s)`);
    }
  }, { seasons });
}

async function refreshPlayerInfo() {
  const season = await getSeason();
  const playerIds = await fetchPlayerIds(season, { activeOnly: false });
  await withIngestionState("player_info", async () => {
    await runWithConcurrency(playerIds, CONFIG.boxscoreConcurrency, async (playerId) => {
      throwIfCronBudgetExceeded("player_info_player");
      const rows = await fetchCommonPlayerInfoRows(playerId);
      const info = normalizePlayerInfoRow(rows[0]);
      if (!info) return;
      await supabaseUpsert("player_info", [info], "player_id");
      await writeCache(
        CacheKeys.playerInfo(playerId),
        info,
        CONFIG.cacheTtlTeamDetailsSec
      );
    });
    logUpsert("player_info", playerIds.length, { season, player_count: playerIds.length });
  }, { season });
}

async function refreshStandings() {
  const seasons = await getSeasonsToSync();
  const seasonTypes = ["Regular Season", "Playoffs"];
  await withIngestionState("league_standings", async () => {
    for (const season of seasons) {
      const teams = await fetchTeamsForSeason(season);
      const teamsById = new Map(
        teams
          .map((team) => mapTeamRow(team))
          .filter(Boolean)
          .map((team) => [team.team_id, team])
      );
      let total = 0;
      for (const seasonType of seasonTypes) {
        throwIfCronBudgetExceeded("standings_season");
        const standings = (await fetchLeagueStandingsRows(season, seasonType))
          .map((row) => normalizeLeagueStanding(row, teamsById))
          .filter(Boolean);
        const cacheKeyValue = CacheKeys.standings(season, "00", seasonType);
        await writeCache(cacheKeyValue, standings, CONFIG.cacheTtlStandingsSec);
        if (seasonType === "Regular Season") {
          const rows = standings
            .map((row) => mapLeagueStandingRow(row, season))
            .filter(Boolean);
          await supabaseUpsert("league_standings", rows, "season,team_id");
          total += rows.length;
        } else {
          await writeApiSnapshot(cacheKeyValue, standings);
          total += standings.length;
        }
      }
      logUpsert("league_standings", total, { season, season_types: seasonTypes });
    }
  }, { seasons });
}

async function refreshTeamStats() {
  const seasons = await getSeasonsToSync();
  await withIngestionState("team_advanced_stats", async () => {
    const snapshotCombos = [
      ["Base", "PerGame"],
      ["Base", "Totals"],
      ["Advanced", "PerGame"],
      ["Advanced", "Totals"],
      ["FourFactors", "PerGame"],
      ["FourFactors", "Totals"],
    ];
    for (const season of seasons) {
      throwIfCronBudgetExceeded("team_stats_season");
      const teams = await fetchTeamsForSeason(season);
      const teamsById = new Map(
        teams
          .map((team) => mapTeamRow(team))
          .filter(Boolean)
          .map((team) => [team.team_id, team])
      );
      const baseRows = await fetchLeagueDashTeamStats(season, "Base");
      const advancedRows = await fetchLeagueDashTeamStats(season, "Advanced");
      const baseByTeam = new Map();
      const advancedByTeam = new Map();
      for (const row of baseRows) {
        const teamId = toNumber(row.TEAM_ID ?? row.team_id);
        if (teamId === null) continue;
        baseByTeam.set(teamId, row);
      }
      for (const row of advancedRows) {
        const teamId = toNumber(row.TEAM_ID ?? row.team_id);
        if (teamId === null) continue;
        advancedByTeam.set(teamId, row);
      }

      const teamIds = new Set([...baseByTeam.keys(), ...advancedByTeam.keys()]);
      const rows = [];
      for (const teamId of teamIds) {
        const base = baseByTeam.get(teamId) || {};
        const advanced = advancedByTeam.get(teamId) || {};
        const ppg = toNumber(base.PTS ?? base.PTS_PG ?? base.PPG);
        const ppgAllowed = toNumber(base.OPP_PTS ?? base.OPP_PTS_PG ?? base.OPP_PPG);
        const apg = toNumber(base.AST ?? base.AST_PG);
        const topg = toNumber(base.TOV ?? base.TO ?? base.TOV_PG);
        const ortg = toNumber(advanced.OFF_RATING ?? advanced.OFF_RTG ?? advanced.E_OFF_RATING);
        const drtg = toNumber(advanced.DEF_RATING ?? advanced.DEF_RTG ?? advanced.E_DEF_RATING);
        const netrtg = toNumber(advanced.NET_RATING ?? advanced.NET_RTG ?? advanced.NETRTG);
        rows.push({
          season,
          team_id: teamId,
          ppg: ppg ?? null,
          ppg_allowed: ppgAllowed ?? null,
          ortg: ortg ?? null,
          ortg_rank: null,
          drtg: drtg ?? null,
          drtg_rank: null,
          apg: apg ?? null,
          topg: topg ?? null,
          netrtg: netrtg ?? null,
        });
      }

      applyRanks(rows, "ortg", "ortg_rank", true);
      applyRanks(rows, "drtg", "drtg_rank", false);

      if (rows.length) {
        await supabaseUpsert("team_advanced_stats", rows, "season,team_id");
      }
      const servingRows = baseRows
        .map((row) => normalizeServingTeamStatsRow(row, teamsById))
        .filter(Boolean);
      await writeCache(
        InternalCacheKeys.teamStats(season, "Base", "PerGame"),
        servingRows,
        CONFIG.cacheTtlTeamStatsSec
      );
      await writeApiSnapshot(
        InternalCacheKeys.teamStats(season, "Base", "PerGame"),
        servingRows
      );
      for (const [measure, perMode] of snapshotCombos) {
        if (measure === "Base" && perMode === "PerGame") {
          continue;
        }
        const comboRows = await fetchLeagueDashTeamStats(season, measure, perMode);
        const normalizedRows = comboRows
          .map((row) => normalizeServingTeamStatsRow(row, teamsById))
          .filter(Boolean);
        await writeApiSnapshot(
          InternalCacheKeys.teamStats(season, measure, perMode),
          normalizedRows
        );
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
      const payload = await fetchTeamDetailsPayload(team.id);
      const detail = normalizeTeamDetailsPayload(payload, team.id);
      const teamId = team.id ?? team.team_id;
      const row = mapTeamDetailRow(detail, teamId);
      if (row && row.team_id) {
        await supabaseUpsert("team_details", [row], "team_id");
        await writeCache(
          CacheKeys.teamDetails(teamId),
          detail,
          CONFIG.cacheTtlTeamDetailsSec
        );
      }
    });
    logUpsert("team_details", teams.length, { season });
  }, { season });
}

async function refreshTeamHistory() {
  const season = await getSeason();
  const teams = await fetchTeamsForSeason(season);
  const combos = [
    ["Regular Season", "Totals"],
    ["Regular Season", "PerGame"],
    ["Playoffs", "Totals"],
    ["Playoffs", "PerGame"],
  ];
  await withIngestionState("team_season_history", async () => {
    let total = 0;
    for (const [seasonType, perMode] of combos) {
      await runWithConcurrency(teams, CONFIG.boxscoreConcurrency, async (team) => {
        throwIfCronBudgetExceeded("team_history_team");
        const rows = (await fetchTeamYearByYearStatsRows(team.id, seasonType, perMode))
          .map((row) => mapTeamHistoryRow(row, seasonType, perMode))
          .filter(Boolean);
        if (!rows.length) return;
        total += rows.length;
        await supabaseUpsert(
          "team_season_history",
          rows,
          "season,team_id,season_type,per_mode"
        );
        await writeCache(
          CacheKeys.teamHistory(team.id, seasonType, perMode),
          rows,
          CONFIG.cacheTtlTeamDetailsSec
        );
      });
    }
    logUpsert("team_season_history", total, { team_count: teams.length });
  }, { season });
}

async function refreshLeagueLeaders() {
  const seasons = await getSeasonsToSync();
  const seasonTypes = ["Regular Season", "Playoffs"];
  const perModes = ["PerGame", "Totals"];
  await withIngestionState("league_leader_rows", async () => {
    let total = 0;
    for (const season of seasons) {
      for (const seasonType of seasonTypes) {
        for (const perMode of perModes) {
          for (const statCategory of LEAGUE_LEADER_STAT_CATEGORIES) {
            throwIfCronBudgetExceeded("league_leaders_combo");
            const rows = (await fetchLeagueLeadersRows(
              season,
              seasonType,
              perMode,
              statCategory
            ))
              .map((row) => mapLeagueLeaderRow(row, season, seasonType, perMode, statCategory))
              .filter(Boolean);
            if (!rows.length) continue;
            total += rows.length;
            await supabaseUpsert(
              "league_leader_rows",
              rows,
              "season,season_type,per_mode,stat_category,rank,player_id"
            );
          }
        }
      }
    }
    logUpsert("league_leader_rows", total, { seasons });
  }, { seasons });
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
      const rows = (await fetchPlayerAwardsRows(playerId))
        .map((row) => mapPlayerAwardRow(row, playerId))
        .filter(Boolean);
      if (rows.length) {
        await supabaseUpsert("player_awards", rows, "player_id,season,description");
      }
      await writeCache(
        CacheKeys.playerAwards(playerId),
        rows,
        CONFIG.cacheTtlPlayerAwardsSec
      );
      total += rows.length;
    });
    logUpsert("player_awards", total, { season, player_count: playerIds.length });
  }, { season, player_count: playerIds.length });
}

async function refreshPlayerSeasonStatsForSeason(season) {
  await invalidateCachePattern(CachePatterns.playerStats(season));
  const seasonTypes = ["Regular Season", "Playoffs"];
  const measures = ["Base", "Advanced", "Misc", "Scoring", "Usage"];
  const perModes = ["PerGame", "Totals"];
  let totalStructuredRows = 0;
  let totalSnapshotRows = 0;
  for (const seasonType of seasonTypes) {
    throwIfCronBudgetExceeded("player_season_stats_combo");
    const baseRows = await fetchLeagueDashPlayerStats(season, seasonType, "Base", "PerGame");
    const structuredRows = baseRows
      .map((row) => mapPlayerSeasonStatsRow(row, season, seasonType))
      .filter(Boolean);
    if (structuredRows.length) {
      await supabaseUpsert(
        "player_season_stats",
        structuredRows,
        "season,player_id,season_type"
      );
      totalStructuredRows += structuredRows.length;
    }

    for (const measure of measures) {
      for (const perMode of perModes) {
        throwIfCronBudgetExceeded("player_stats_snapshot_combo");
        const comboRows =
          measure === "Base" && perMode === "PerGame"
            ? baseRows
            : await fetchLeagueDashPlayerStats(season, seasonType, measure, perMode);
        const snapshotRows = comboRows
          .map((row) => normalizePlayerStatsSnapshotRow(row))
          .filter(Boolean);
        const cacheKeyValue = CacheKeys.playerStats(season, seasonType, measure, perMode);
        await writeCache(cacheKeyValue, snapshotRows, CONFIG.cacheTtlPlayerStatsSec);
        await writeApiSnapshot(cacheKeyValue, snapshotRows);
        totalSnapshotRows += snapshotRows.length;
      }
    }
  }
  logUpsert("player_season_stats", totalStructuredRows, { season });
  logUpsert("player_stats_snapshots", totalSnapshotRows, { season });
}

async function refreshPlayerSeasonStats() {
  const seasons = await getSeasonsToSync();
  await withIngestionState("player_season_stats", async () => {
    const errors = [];
    for (const season of seasons) {
      throwIfCronBudgetExceeded("player_season_stats_season");
      try {
        await refreshPlayerSeasonStatsForSeason(season);
      } catch (error) {
        errors.push({ season, error: String(error) });
        log("player_season_stats season failed", { season, ...formatErrorForLog(error) });
      }
    }
    if (errors.length) {
      throw new Error(`player_season_stats failed for ${errors.length} season(s)`);
    }
  }, { seasons });
}

function parseDateTime(value) {
  const text = cleanText(value);
  if (!text) return null;
  const normalized = text.replace("Z", "+00:00");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeTraditionalBoxscorePlayer(row) {
  const playerId = toInteger(row.PLAYER_ID);
  const teamId = toInteger(row.TEAM_ID);
  if (playerId === null || teamId === null) return null;
  return {
    player_id: playerId,
    player_name: cleanText(row.PLAYER_NAME) || "Unknown player",
    team_id: teamId,
    team_abbreviation: cleanText(row.TEAM_ABBREVIATION) || "UNK",
    team_city: cleanText(row.TEAM_CITY),
    start_position: cleanText(row.START_POSITION),
    comment: cleanText(row.COMMENT),
    minutes: cleanText(row.MIN),
    field_goals_made: toNumber(row.FGM),
    field_goals_attempted: toNumber(row.FGA),
    field_goal_pct: toNumber(row.FG_PCT),
    three_point_made: toNumber(row.FG3M),
    three_point_attempted: toNumber(row.FG3A),
    three_point_pct: toNumber(row.FG3_PCT),
    free_throws_made: toNumber(row.FTM),
    free_throws_attempted: toNumber(row.FTA),
    free_throw_pct: toNumber(row.FT_PCT),
    offensive_rebounds: toNumber(row.OREB),
    defensive_rebounds: toNumber(row.DREB),
    rebounds: toNumber(row.REB),
    assists: toNumber(row.AST),
    steals: toNumber(row.STL),
    blocks: toNumber(row.BLK),
    turnovers: toNumber(row.TO),
    fouls: toNumber(row.PF),
    points: toNumber(row.PTS),
    plus_minus: toNumber(row.PLUS_MINUS),
  };
}

function normalizeBoxscoreTeamTotals(row) {
  const teamId = toInteger(row.TEAM_ID);
  if (teamId === null) return null;
  return {
    team_id: teamId,
    team_name: cleanText(row.TEAM_NAME),
    team_abbreviation: cleanText(row.TEAM_ABBREVIATION),
    minutes: cleanText(row.MIN),
    field_goals_made: toNumber(row.FGM),
    field_goals_attempted: toNumber(row.FGA),
    field_goal_pct: toNumber(row.FG_PCT),
    three_point_made: toNumber(row.FG3M),
    three_point_attempted: toNumber(row.FG3A),
    three_point_pct: toNumber(row.FG3_PCT),
    free_throws_made: toNumber(row.FTM),
    free_throws_attempted: toNumber(row.FTA),
    free_throw_pct: toNumber(row.FT_PCT),
    offensive_rebounds: toNumber(row.OREB),
    defensive_rebounds: toNumber(row.DREB),
    rebounds: toNumber(row.REB),
    assists: toNumber(row.AST),
    steals: toNumber(row.STL),
    blocks: toNumber(row.BLK),
    turnovers: toNumber(row.TO),
    fouls: toNumber(row.PF),
    points: toNumber(row.PTS),
    plus_minus: toNumber(row.PLUS_MINUS),
  };
}

function normalizeStarterBenchRow(row) {
  const teamId = toInteger(row.TEAM_ID);
  if (teamId === null) return null;
  return {
    team_id: teamId,
    team_name: cleanText(row.TEAM_NAME),
    team_abbreviation: cleanText(row.TEAM_ABBREVIATION),
    label: cleanText(row.STARTERS_BENCH) || "",
    minutes: cleanText(row.MIN),
    field_goals_made: toNumber(row.FGM),
    field_goals_attempted: toNumber(row.FGA),
    field_goal_pct: toNumber(row.FG_PCT),
    three_point_made: toNumber(row.FG3M),
    three_point_attempted: toNumber(row.FG3A),
    three_point_pct: toNumber(row.FG3_PCT),
    free_throws_made: toNumber(row.FTM),
    free_throws_attempted: toNumber(row.FTA),
    free_throw_pct: toNumber(row.FT_PCT),
    offensive_rebounds: toNumber(row.OREB),
    defensive_rebounds: toNumber(row.DREB),
    rebounds: toNumber(row.REB),
    assists: toNumber(row.AST),
    steals: toNumber(row.STL),
    blocks: toNumber(row.BLK),
    turnovers: toNumber(row.TO),
    fouls: toNumber(row.PF),
    points: toNumber(row.PTS),
  };
}

function formatLeaderLine(row) {
  const parts = [];
  if (row.points !== null && row.points !== undefined) parts.push(`${Math.trunc(row.points)} PTS`);
  if (row.rebounds !== null && row.rebounds !== undefined) {
    parts.push(`${Math.trunc(row.rebounds)} REB`);
  }
  if (row.assists !== null && row.assists !== undefined) {
    parts.push(`${Math.trunc(row.assists)} AST`);
  }
  return parts.join(" • ");
}

function buildTeamLeaders(players, teamId) {
  return (players || [])
    .filter((row) => row.team_id === teamId && !row.comment)
    .sort((left, right) => (right.points ?? 0) - (left.points ?? 0))
    .slice(0, 3)
    .map((row) => ({
      player_id: row.player_id,
      player_name: row.player_name,
      points: row.points,
      rebounds: row.rebounds,
      assists: row.assists,
      stat_line: formatLeaderLine(row),
    }));
}

function buildLineScore(rows, homeTeamId, awayTeamId) {
  const byTeamId = new Map(
    (rows || [])
      .map((row) => [toInteger(row.TEAM_ID), row])
      .filter(([teamId]) => teamId !== null)
  );
  const homeRow = byTeamId.get(homeTeamId) || {};
  const awayRow = byTeamId.get(awayTeamId) || {};
  const periods = [];
  for (let period = 1; period <= 4; period += 1) {
    periods.push({
      label: `Q${period}`,
      home: toInteger(homeRow[`PTS_QTR${period}`]) ?? 0,
      away: toInteger(awayRow[`PTS_QTR${period}`]) ?? 0,
    });
  }
  for (let overtime = 1; overtime <= 10; overtime += 1) {
    const home = toInteger(homeRow[`PTS_OT${overtime}`]) ?? 0;
    const away = toInteger(awayRow[`PTS_OT${overtime}`]) ?? 0;
    if (home === 0 && away === 0) continue;
    periods.push({
      label: overtime === 1 ? "OT" : `OT${overtime}`,
      home,
      away,
    });
  }
  return periods;
}

function buildBoxscoreTeamCard(teamId, isHome, lineScoreRows, players) {
  const row = (lineScoreRows || []).find((item) => toInteger(item.TEAM_ID) === teamId) || {};
  return {
    team_id: teamId,
    team_name: cleanText(row.TEAM_NICKNAME ?? row.TEAM_NAME),
    team_city: cleanText(row.TEAM_CITY_NAME ?? row.TEAM_CITY),
    team_abbreviation: cleanText(row.TEAM_ABBREVIATION),
    score: toInteger(row.PTS) ?? 0,
    record: cleanText(row.TEAM_WINS_LOSSES),
    is_home: isHome,
    leaders: buildTeamLeaders(players, teamId),
  };
}

async function fetchBoxscoreFromStats(gameId) {
  const traditionalUrl = new URL("https://stats.nba.com/stats/boxscoretraditionalv2");
  traditionalUrl.searchParams.set("GameID", gameId);
  traditionalUrl.searchParams.set("StartPeriod", "0");
  traditionalUrl.searchParams.set("EndPeriod", "0");
  traditionalUrl.searchParams.set("StartRange", "0");
  traditionalUrl.searchParams.set("EndRange", "0");
  traditionalUrl.searchParams.set("RangeType", "0");
  const summaryUrl = new URL("https://stats.nba.com/stats/boxscoresummaryv2");
  summaryUrl.searchParams.set("GameID", gameId);

  const [traditionalPayload, summaryPayload] = await Promise.all([
    statsRequest(traditionalUrl.toString()),
    statsRequest(summaryUrl.toString()),
  ]);

  const traditionalPlayers = extractResultSetRows(traditionalPayload, "PlayerStats")
    .map(normalizeTraditionalBoxscorePlayer)
    .filter(Boolean);
  const teamTotals = extractResultSetRows(traditionalPayload, "TeamStats")
    .map(normalizeBoxscoreTeamTotals)
    .filter(Boolean);
  const starterBench = extractResultSetRows(traditionalPayload, "TeamStarterBenchStats")
    .map(normalizeStarterBenchRow)
    .filter(Boolean);
  const gameSummary = extractResultSetRows(summaryPayload, "GameSummary")[0] || null;
  if (!gameSummary) {
    throw new Error(`Missing boxscore summary for game ${gameId}`);
  }
  const homeTeamId = toInteger(gameSummary.HOME_TEAM_ID);
  const awayTeamId = toInteger(gameSummary.VISITOR_TEAM_ID);
  if (homeTeamId === null || awayTeamId === null) {
    throw new Error(`Missing boxscore teams for game ${gameId}`);
  }

  const lineScoreRows = extractResultSetRows(summaryPayload, "LineScore");
  const gameInfo = extractResultSetRows(summaryPayload, "GameInfo")[0] || {};
  const officials = extractResultSetRows(summaryPayload, "Officials")
    .map((row) =>
      [cleanText(row.FIRST_NAME), cleanText(row.LAST_NAME)].filter(Boolean).join(" ").trim()
    )
    .filter(Boolean);

  let advancedPlayers = [];
  try {
    advancedPlayers = await fetchBoxscoreAdvancedPlayers(gameId);
  } catch (error) {
    log("Failed to refresh boxscore advanced players from stats.nba.com", {
      game_id: gameId,
      ...formatErrorForLog(error),
    });
  }

  return {
    game_id: gameId,
    status: cleanText(gameSummary.GAME_STATUS_TEXT),
    game_date: parseDateTime(gameSummary.GAME_DATE_EST),
    start_time: parseDateTime(gameSummary.GAME_DATE_EST),
    arena: cleanText(gameInfo.ARENA),
    attendance: toInteger(gameInfo.ATTENDANCE),
    summary: null,
    officials,
    home_team: buildBoxscoreTeamCard(homeTeamId, true, lineScoreRows, traditionalPlayers),
    away_team: buildBoxscoreTeamCard(awayTeamId, false, lineScoreRows, traditionalPlayers),
    line_score: buildLineScore(lineScoreRows, homeTeamId, awayTeamId),
    team_totals: teamTotals,
    starter_bench: starterBench,
    traditional_players: traditionalPlayers,
    advanced_players: advancedPlayers,
  };
}

function parseIsoMinutes(value) {
  const text = cleanText(value);
  if (!text) return null;
  const match = text.match(/^PT(?:(\d+)M)?(?:(\d+)(?:\.\d+)?S)?$/);
  if (!match) return text;
  const minutes = Number(match[1] || 0);
  const seconds = Number(match[2] || 0);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function buildCdnPlayers(team) {
  const teamId = toInteger(team.teamId);
  return (team.players || []).map((player) => {
    const stats = player.statistics || {};
    return {
      player_id: toInteger(player.personId),
      player_name: cleanText(player.name) || "Unknown player",
      team_id: teamId,
      team_abbreviation: cleanText(team.teamTricode) || "UNK",
      team_city: cleanText(team.teamCity),
      start_position: cleanText(player.position),
      comment: null,
      minutes: parseIsoMinutes(stats.minutesCalculated ?? stats.minutes),
      field_goals_made: toNumber(stats.fieldGoalsMade),
      field_goals_attempted: toNumber(stats.fieldGoalsAttempted),
      field_goal_pct: toNumber(stats.fieldGoalsPercentage),
      three_point_made: toNumber(stats.threePointersMade),
      three_point_attempted: toNumber(stats.threePointersAttempted),
      three_point_pct: toNumber(stats.threePointersPercentage),
      free_throws_made: toNumber(stats.freeThrowsMade),
      free_throws_attempted: toNumber(stats.freeThrowsAttempted),
      free_throw_pct: toNumber(stats.freeThrowsPercentage),
      offensive_rebounds: toNumber(stats.reboundsOffensive),
      defensive_rebounds: toNumber(stats.reboundsDefensive),
      rebounds: toNumber(stats.reboundsTotal),
      assists: toNumber(stats.assists),
      steals: toNumber(stats.steals),
      blocks: toNumber(stats.blocks),
      turnovers: toNumber(stats.turnovers),
      fouls: toNumber(stats.foulsPersonal),
      points: toNumber(stats.points),
      plus_minus: toNumber(stats.plusMinusPoints),
    };
  });
}

function buildCdnTeamTotals(team) {
  const stats = team.statistics || {};
  return {
    team_id: toInteger(team.teamId),
    team_name: cleanText(team.teamName),
    team_abbreviation: cleanText(team.teamTricode),
    minutes: parseIsoMinutes(stats.minutesCalculated ?? stats.minutes),
    field_goals_made: toNumber(stats.fieldGoalsMade),
    field_goals_attempted: toNumber(stats.fieldGoalsAttempted),
    field_goal_pct: toNumber(stats.fieldGoalsPercentage),
    three_point_made: toNumber(stats.threePointersMade),
    three_point_attempted: toNumber(stats.threePointersAttempted),
    three_point_pct: toNumber(stats.threePointersPercentage),
    free_throws_made: toNumber(stats.freeThrowsMade),
    free_throws_attempted: toNumber(stats.freeThrowsAttempted),
    free_throw_pct: toNumber(stats.freeThrowsPercentage),
    offensive_rebounds: toNumber(stats.reboundsOffensive),
    defensive_rebounds: toNumber(stats.reboundsDefensive),
    rebounds: toNumber(stats.reboundsTotal),
    assists: toNumber(stats.assists),
    steals: toNumber(stats.steals),
    blocks: toNumber(stats.blocks),
    turnovers: toNumber(stats.turnoversTotal ?? stats.turnovers),
    fouls: toNumber(stats.foulsPersonal),
    points: toNumber(stats.points),
    plus_minus: toNumber(stats.plusMinusPoints),
  };
}

function buildCdnLineScore(homeTeam, awayTeam) {
  const homePeriods = homeTeam.periods || [];
  const awayPeriods = awayTeam.periods || [];
  const totalPeriods = Math.max(homePeriods.length, awayPeriods.length);
  const rows = [];
  for (let index = 0; index < totalPeriods; index += 1) {
    rows.push({
      label: index < 4 ? `Q${index + 1}` : index === 4 ? "OT" : `OT${index - 3}`,
      home: toInteger(homePeriods[index]?.score) ?? 0,
      away: toInteger(awayPeriods[index]?.score) ?? 0,
    });
  }
  return rows;
}

function buildCdnTeamCard(team, isHome, players) {
  const teamId = toInteger(team.teamId);
  return {
    team_id: teamId,
    team_name: cleanText(team.teamName),
    team_city: cleanText(team.teamCity),
    team_abbreviation: cleanText(team.teamTricode),
    score: toInteger(team.score) ?? 0,
    record: null,
    is_home: isHome,
    leaders: buildTeamLeaders(players, teamId),
  };
}

async function fetchBoxscoreFromCdn(gameId) {
  const response = await fetch(
    `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`
  );
  if (!response.ok) {
    throw new Error(`NBA boxscore CDN unavailable for ${gameId}`);
  }
  const payload = await response.json();
  const game = payload.game || {};
  const homeTeam = game.homeTeam || {};
  const awayTeam = game.awayTeam || {};
  const traditionalPlayers = [...buildCdnPlayers(homeTeam), ...buildCdnPlayers(awayTeam)].filter(
    (row) => row.player_id !== null && row.team_id !== null
  );

  return {
    game_id: cleanText(game.gameId) || gameId,
    status: cleanText(game.gameStatusText),
    game_date: parseDateTime(game.gameTimeUTC),
    start_time: parseDateTime(game.gameTimeUTC),
    arena: cleanText(game.arena?.arenaName ?? game.arena?.arenaCity),
    attendance: toInteger(game.attendance),
    summary: null,
    officials: (game.officials || [])
      .map((row) =>
        [cleanText(row.firstName), cleanText(row.familyName)].filter(Boolean).join(" ").trim()
      )
      .filter(Boolean),
    home_team: buildCdnTeamCard(homeTeam, true, traditionalPlayers),
    away_team: buildCdnTeamCard(awayTeam, false, traditionalPlayers),
    line_score: buildCdnLineScore(homeTeam, awayTeam),
    team_totals: [buildCdnTeamTotals(homeTeam), buildCdnTeamTotals(awayTeam)].filter(
      (row) => row.team_id !== null
    ),
    starter_bench: [],
    traditional_players: traditionalPlayers,
    advanced_players: [],
  };
}

async function fetchBoxscore(gameId) {
  try {
    return await fetchBoxscoreFromStats(gameId);
  } catch (error) {
    log("Stats boxscore fetch failed; falling back to CDN", {
      game_id: gameId,
      ...formatErrorForLog(error),
    });
    return fetchBoxscoreFromCdn(gameId);
  }
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
      assist_pct: row.assist_pct ?? null,
      assist_to_turnover: row.assist_to_turnover ?? null,
      rebound_pct: row.rebound_pct ?? null,
      offensive_rebound_pct: row.offensive_rebound_pct ?? null,
      defensive_rebound_pct: row.defensive_rebound_pct ?? null,
      pace: row.pace ?? null,
      pace_per40: row.pace_per40 ?? null,
      possessions: row.possessions ?? null,
      pie: row.pie ?? null,
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
      assist_pct: row.assist_pct ?? null,
      assist_to_turnover: row.assist_to_turnover ?? null,
      rebound_pct: row.rebound_pct ?? null,
      offensive_rebound_pct: row.offensive_rebound_pct ?? null,
      defensive_rebound_pct: row.defensive_rebound_pct ?? null,
      pace: row.pace ?? null,
      pace_per40: row.pace_per40 ?? null,
      possessions: row.possessions ?? null,
      pie: row.pie ?? null,
    });
  }

  return combined;
}

function buildGameSnapshotGameRow(boxscore) {
  const homeTeam = boxscore?.home_team || {};
  const awayTeam = boxscore?.away_team || {};
  const gameDate = toDateText(boxscore?.game_date ?? boxscore?.start_time);
  return compactObject({
    game_id: cleanText(boxscore?.game_id),
    date: gameDate,
    start_time: toText(boxscore?.start_time),
    home_team_id: toInteger(homeTeam.team_id),
    home_team_name: cleanText(homeTeam.team_name),
    home_team_score: toInteger(homeTeam.score),
    away_team_id: toInteger(awayTeam.team_id),
    away_team_name: cleanText(awayTeam.team_name),
    away_team_score: toInteger(awayTeam.score),
    season: inferSeasonYear(gameDate),
  });
}

function buildGameSnapshotPayload(boxscore) {
  return {
    p_game: buildGameSnapshotGameRow(boxscore),
    p_boxscore: toBoxscoreRow(boxscore),
    p_players: toBoxscorePlayers(boxscore),
  };
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

async function publishGameSnapshot(boxscore) {
  const payload = buildGameSnapshotPayload(boxscore);
  try {
    const result = await supabaseRpc("publish_game_snapshot", payload);
    if (result && typeof result.players_upserted === "number") {
      return result.players_upserted;
    }
    return payload.p_players.length;
  } catch (error) {
    if (!isMissingRpcFunctionError(error)) {
      throw error;
    }
    log("publish_game_snapshot RPC unavailable; falling back to legacy writes", {
      game_id: boxscore.game_id,
      ...formatErrorForLog(error),
    });
    if (payload.p_game && Object.keys(payload.p_game).length > 1) {
      await supabaseUpsert("games", [payload.p_game], "game_id", { recordState: false });
    }
    const playersCount = await upsertBoxscore(boxscore);
    return playersCount;
  }
}

async function updateBoxscoreForGame(gameId) {
  const boxscore = await fetchBoxscore(gameId);
  const playersCount = await publishGameSnapshot(boxscore);
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
    const games = await fetchGames(season, { dateFrom: today, dateTo: today });
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

async function refreshRecentBoxscores({ lookbackDays, entity = "boxscores" } = {}) {
  const season = await getSeason();
  const endDate = new Date();
  const startDate = new Date(endDate);
  const resolvedLookback = Number.isFinite(lookbackDays)
    ? Math.max(0, lookbackDays)
    : CONFIG.boxscoreLookbackDays;
  startDate.setDate(startDate.getDate() - resolvedLookback);
  const dateFrom = formatDateInTZ(CONFIG.timeZone, startDate);
  const dateTo = formatDateInTZ(CONFIG.timeZone, endDate);
  await withIngestionState(entity, async () => {
    throwIfCronBudgetExceeded("boxscores_page");
    const games = await fetchGamesForRecentWindow(season, { dateFrom, dateTo });
    const gameIds = [...new Set(games.map((row) => row.game_id).filter(Boolean))];
    let totalPlayers = 0;
    throwIfCronBudgetExceeded("boxscores_updates");
    await runWithConcurrency(gameIds, CONFIG.boxscoreConcurrency, async (gameId) => {
      const result = await updateBoxscoreForGame(gameId);
      totalPlayers += result.playersCount || 0;
    });
    logUpsert("boxscores", gameIds.length, { date_from: dateFrom, date_to: dateTo });
    logUpsert("boxscore_players", totalPlayers, { date_from: dateFrom, date_to: dateTo });
  }, { season, date_from: dateFrom, date_to: dateTo, lookback_days: resolvedLookback });
}

async function refreshRecentGames({ lookbackDays, entity = "games_recent" } = {}) {
  const season = await getSeason();
  const endDate = new Date();
  const startDate = new Date(endDate);
  const resolvedLookback = Number.isFinite(lookbackDays)
    ? Math.max(0, lookbackDays)
    : CONFIG.cronLiveGamesLookbackDays;
  startDate.setDate(startDate.getDate() - resolvedLookback);
  const dateFrom = formatDateInTZ(CONFIG.timeZone, startDate);
  const dateTo = formatDateInTZ(CONFIG.timeZone, endDate);
  await withIngestionState(entity, async () => {
    const games = await fetchGamesForRecentWindow(season, { dateFrom, dateTo });
    const rows = games.map((row) => mapGameRow(row, season)).filter(Boolean);
    let total = 0;
    if (rows.length) {
      await supabaseUpsert("games", rows, "game_id");
      total += rows.length;
    }
    logUpsert("games", total, { season, date_from: dateFrom, date_to: dateTo });
  }, { season, date_from: dateFrom, date_to: dateTo, lookback_days: resolvedLookback });
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
        errors.push({ item, error: String(error) });
        log("Worker task failed", { item, ...formatErrorForLog(error, { includeStack: true }) });
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
    inFlight = true;
    try {
      await fn();
    } catch (error) {
      log(`${name} task failed`, formatErrorForLog(error, { includeStack: true }));
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
    console.error("Worker configuration invalid", formatErrorForLog(error, { includeStack: true }));
    process.exit(1);
  }

  log("Worker starting", {
    timeZone: CONFIG.timeZone,
  });
}

async function runCronTask(entity, intervalMs, fn) {
  if (!(await shouldRun(entity, intervalMs, { logSkip: true }))) {
    return;
  }
  throwIfCronBudgetExceeded(`cron_task:${entity}`);
  try {
    await fn();
  } catch (error) {
    if (isCronBudgetError(error)) {
      throw error;
    }
    log(`${entity} task failed`, formatErrorForLog(error, { includeStack: true }));
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
    const liveBoxscoreIntervalMs = gate.inWindow
      ? CONFIG.cronLiveBoxscoreIntervalMs
      : CONFIG.cronOffWindowLiveBoxscoreIntervalMs;
    await runCronTask("boxscores_live", liveBoxscoreIntervalMs, () =>
      refreshRecentBoxscores({
        lookbackDays: CONFIG.cronLiveBoxscoreLookbackDays,
        entity: "boxscores_live",
      })
    );
    const liveGamesIntervalMs = gate.inWindow
      ? CONFIG.cronLiveGamesIntervalMs
      : CONFIG.cronOffWindowLiveGamesIntervalMs;
    await runCronTask("games_recent", liveGamesIntervalMs, () =>
      refreshRecentGames({
        lookbackDays: CONFIG.cronLiveGamesLookbackDays,
        entity: "games_recent",
      })
    );
    if (shouldRunMaintenanceTask("boxscores_backfill")) {
      await runCronTask("boxscores", CONFIG.boxscoreBackfillIntervalMs, () =>
        refreshRecentBoxscores({
          lookbackDays: CONFIG.boxscoreLookbackDays,
          entity: "boxscores",
        })
      );
    }
    if (shouldRunMaintenanceTask("games")) {
      await runCronTask("games", CONFIG.gamesIntervalMs, refreshGames);
    }
    await runCronTask("league_standings", CONFIG.standingsIntervalMs, refreshStandings);
    await runCronTask("teams", CONFIG.teamsIntervalMs, refreshTeams);
    if (shouldRunMaintenanceTask("players")) {
      await runCronTask("players", CONFIG.playersIntervalMs, refreshPlayers);
    }
    if (shouldRunMaintenanceTask("players_bio")) {
      await runCronTask("players_bio", CONFIG.playersIntervalMs, refreshPlayerBioStats);
    }
    if (shouldRunMaintenanceTask("player_info")) {
      await runCronTask("player_info", CONFIG.playersIntervalMs, refreshPlayerInfo);
    }
    if (shouldRunMaintenanceTask("player_season_stats")) {
      await runCronTask("player_season_stats", CONFIG.playerStatsIntervalMs, refreshPlayerSeasonStats);
    }
    if (shouldRunMaintenanceTask("player_awards")) {
      await runCronTask("player_awards", CONFIG.playerAwardsIntervalMs, refreshPlayerAwards);
    }
    if (shouldRunMaintenanceTask("league_leader_rows")) {
      await runCronTask("league_leader_rows", CONFIG.teamStatsIntervalMs, refreshLeagueLeaders);
    }
    if (shouldRunMaintenanceTask("team_details")) {
      await runCronTask("team_details", CONFIG.teamDetailsIntervalMs, refreshTeamDetails);
    }
    if (shouldRunMaintenanceTask("team_season_history")) {
      await runCronTask("team_season_history", CONFIG.teamDetailsIntervalMs, refreshTeamHistory);
    }
    if (shouldRunMaintenanceTask("team_advanced_stats")) {
      await runCronTask("team_advanced_stats", CONFIG.teamStatsIntervalMs, refreshTeamStats);
    }
  } catch (error) {
    finalStatus = "failed";
    errorMessage = error instanceof Error ? error.message : String(error);
    if (isCronBudgetError(error)) {
      log("Cron budget exceeded; stopping remaining tasks");
    } else {
      log("Cron run failed", formatErrorForLog(error, { includeStack: true }));
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
  scheduleTask("players-bio", CONFIG.playersIntervalMs, refreshPlayerBioStats, true);
  scheduleTask("player-info", CONFIG.playersIntervalMs, refreshPlayerInfo, true);
  scheduleTask("standings", CONFIG.standingsIntervalMs, refreshStandings, true);
  scheduleTask("player-awards", CONFIG.playerAwardsIntervalMs, refreshPlayerAwards, true);
  scheduleTask("player-season-stats", CONFIG.playerStatsIntervalMs, refreshPlayerSeasonStats, true);
  scheduleTask("league-leaders", CONFIG.teamStatsIntervalMs, refreshLeagueLeaders, true);
  scheduleTask("team-advanced-stats", CONFIG.teamStatsIntervalMs, refreshTeamStats, true);
  scheduleTask("team-details", CONFIG.teamDetailsIntervalMs, refreshTeamDetails, true);
  scheduleTask("team-history", CONFIG.teamDetailsIntervalMs, refreshTeamHistory, true);
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
        console.error("Cron run failed", formatErrorForLog(error, { includeStack: true }));
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
  buildSupportedSeasons,
  normalizeBooleanText,
  normalizeActiveFlag,
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
  normalizePlayerInfoRow,
  normalizePlayerStatsSnapshotRow,
  normalizeLeagueStanding,
  normalizeServingTeamStatsRow,
  normalizeTeamDetailsPayload,
  mapTeamHistoryRow,
  mapLeagueLeaderRow,
  applyRanks,
  computeRetryWaitMs,
  dedupeRowsForConflict,
  parseStatsEndpointUrl,
  formatErrorForLog,
  compactObject,
  toDateText,
  inferSeasonYear,
  isMissingRpcFunctionError,
  parseCursor,
  parseCronBudgetCursor,
  chunkArray,
  buildGameSnapshotGameRow,
  buildGameSnapshotPayload,
  fetchGames,
};
