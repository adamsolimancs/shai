#!/usr/bin/env node
"use strict";

if (typeof fetch !== "function") {
  console.error("This worker requires Node.js 18+ (global fetch).");
  process.exit(1);
}

const CONFIG = {
  apiBaseUrl: process.env.NBA_API_BASE_URL || "http://localhost:8080",
  apiKey: process.env.NBA_API_KEY,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  supabaseSchema: process.env.SUPABASE_SCHEMA || "public",
  seasonOverride: process.env.NBA_SEASON,
  timeZone: process.env.NBA_TIME_ZONE || "America/New_York",
  livePollIntervalMs: Number(process.env.LIVE_GAMES_INTERVAL_MS || 5000),
  scoreboardIntervalMs: Number(process.env.SCOREBOARD_INTERVAL_MS || 10000),
  teamsIntervalMs: Number(process.env.TEAMS_INTERVAL_MS || 6 * 60 * 60 * 1000),
  playersIntervalMs: Number(process.env.PLAYERS_INTERVAL_MS || 6 * 60 * 60 * 1000),
  standingsIntervalMs: Number(process.env.STANDINGS_INTERVAL_MS || 15 * 60 * 1000),
  teamStatsIntervalMs: Number(process.env.TEAM_STATS_INTERVAL_MS || 60 * 60 * 1000),
  statusRefreshMs: Number(process.env.STATUS_REFRESH_MS || 60 * 1000),
  boxscoreConcurrency: Number(process.env.BOXSCORE_CONCURRENCY || 3),
  upsertChunkSize: Number(process.env.UPSERT_CHUNK_SIZE || 200),
};

if (!CONFIG.apiKey) {
  console.error("NBA_API_KEY is required.");
  process.exit(1);
}
if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const activeGameIds = new Set();
const statusCache = new Map();
let cachedSeason = null;
let cachedSeasonAt = 0;

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

function formatDateInTZ(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
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

async function apiRequest(path) {
  const url = path.startsWith("http") ? path : `${CONFIG.apiBaseUrl}${path}`;
  const response = await fetch(url, {
    headers: {
      "x-api-key": CONFIG.apiKey,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API ${response.status}: ${body}`);
  }
  const payload = await response.json();
  if (!payload || !payload.ok) {
    throw new Error(`API error: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function supabaseUpsert(table, rows, onConflict) {
  if (!rows || rows.length === 0) return;
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
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase ${table} upsert failed: ${response.status} ${body}`);
  }
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
  await supabaseUpsert("ingestion_state", [row], "source,entity");
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
  const now = Date.now();
  if (cachedSeason && now - cachedSeasonAt < 6 * 60 * 60 * 1000) {
    return cachedSeason;
  }
  const payload = await apiRequest("/v1/meta");
  const seasons = payload.data?.supported_seasons || [];
  const season = seasons.at(-1);
  if (!season) {
    throw new Error("Unable to determine active season");
  }
  cachedSeason = season;
  cachedSeasonAt = now;
  return season;
}

async function refreshTeams() {
  const season = await getSeason();
  await withIngestionState("teams", async () => {
    const payload = await apiRequest(`/v1/teams?season=${season}`);
    await supabaseUpsert("teams", payload.data, "id");
    log(`Upserted ${payload.data.length} teams`);
  }, { season });
}

async function refreshPlayers() {
  const season = await getSeason();
  await withIngestionState("players", async () => {
    let page = 1;
    const pageSize = 200;
    let total = 0;
    while (true) {
      const payload = await apiRequest(`/v1/players?season=${season}&page=${page}&page_size=${pageSize}`);
      const rows = payload.data || [];
      if (rows.length) {
        await supabaseUpsert("players", rows, "id");
        total += rows.length;
      }
      const nextPage = payload.meta?.pagination?.next;
      if (!nextPage) break;
      page = nextPage;
    }
    log(`Upserted ${total} players`);
  }, { season });
}

async function refreshStandings() {
  const season = await getSeason();
  await withIngestionState("league_standings", async () => {
    const payload = await apiRequest(`/v1/league_standings?season=${season}`);
    const rows = (payload.data || []).map((row) => ({ ...row, season }));
    await supabaseUpsert("league_standings", rows, "season,team_id");
    log(`Upserted ${rows.length} league standings`);
  }, { season });
}

async function refreshTeamStats() {
  const season = await getSeason();
  await withIngestionState("team_stats", async () => {
    const payload = await apiRequest(`/v1/teams/stats?season=${season}`);
    const rows = (payload.data || []).map((row) => ({ ...row, season }));
    await supabaseUpsert("team_stats", rows, "season,team_id");
    log(`Upserted ${rows.length} team stats`);
  }, { season });
}

async function fetchBoxscore(gameId) {
  const payload = await apiRequest(`/v1/boxscores/${gameId}`);
  return payload.data;
}

function toBoxscoreRow(boxscore) {
  return {
    game_id: boxscore.game_id,
    status: boxscore.status,
    game_date: boxscore.game_date,
    start_time: boxscore.start_time,
    arena: boxscore.arena,
    attendance: boxscore.attendance,
    summary: boxscore.summary,
    officials: boxscore.officials,
    home_team: boxscore.home_team,
    away_team: boxscore.away_team,
    line_score: boxscore.line_score,
    team_totals: boxscore.team_totals,
    starter_bench: boxscore.starter_bench,
  };
}

function toBoxscorePlayers(boxscore) {
  const traditional = (boxscore.traditional_players || []).map((row) => ({
    game_id: boxscore.game_id,
    player_id: row.player_id,
    player_name: row.player_name,
    team_id: row.team_id,
    team_abbreviation: row.team_abbreviation,
    team_city: row.team_city,
    minutes: row.minutes,
    stat_type: "traditional",
    start_position: row.start_position,
    comment: row.comment,
    field_goals_made: row.field_goals_made,
    field_goals_attempted: row.field_goals_attempted,
    field_goal_pct: row.field_goal_pct,
    three_point_made: row.three_point_made,
    three_point_attempted: row.three_point_attempted,
    three_point_pct: row.three_point_pct,
    free_throws_made: row.free_throws_made,
    free_throws_attempted: row.free_throws_attempted,
    free_throw_pct: row.free_throw_pct,
    offensive_rebounds: row.offensive_rebounds,
    defensive_rebounds: row.defensive_rebounds,
    rebounds: row.rebounds,
    assists: row.assists,
    steals: row.steals,
    blocks: row.blocks,
    turnovers: row.turnovers,
    fouls: row.fouls,
    points: row.points,
    plus_minus: row.plus_minus,
  }));

  const advanced = (boxscore.advanced_players || []).map((row) => ({
    game_id: boxscore.game_id,
    player_id: row.player_id,
    player_name: row.player_name,
    team_id: row.team_id,
    team_abbreviation: row.team_abbreviation,
    team_city: null,
    minutes: row.minutes,
    stat_type: "advanced",
    start_position: null,
    comment: null,
    offensive_rating: row.offensive_rating,
    defensive_rating: row.defensive_rating,
    net_rating: row.net_rating,
    usage_pct: row.usage_pct,
    true_shooting_pct: row.true_shooting_pct,
    effective_fg_pct: row.effective_fg_pct,
    assist_pct: row.assist_pct,
    assist_to_turnover: row.assist_to_turnover,
    rebound_pct: row.rebound_pct,
    offensive_rebound_pct: row.offensive_rebound_pct,
    defensive_rebound_pct: row.defensive_rebound_pct,
    pace: row.pace,
    pace_per40: row.pace_per40,
    possessions: row.possessions,
    pie: row.pie,
  }));

  return traditional.concat(advanced);
}

async function upsertBoxscore(boxscore) {
  await supabaseUpsert("boxscores", [toBoxscoreRow(boxscore)], "game_id");
  const players = toBoxscorePlayers(boxscore);
  if (players.length) {
    const chunks = chunkArray(players, CONFIG.upsertChunkSize);
    for (const chunk of chunks) {
      await supabaseUpsert("boxscore_players", chunk, "game_id,player_id,stat_type");
    }
  }
}

async function updateBoxscoreForGame(gameId) {
  const boxscore = await fetchBoxscore(gameId);
  await upsertBoxscore(boxscore);
  const status = boxscore.status || null;
  statusCache.set(gameId, { status, checkedAt: Date.now() });
  if (isFinalStatus(status) || !isLiveStatus(status)) {
    activeGameIds.delete(gameId);
  } else {
    activeGameIds.add(gameId);
  }
  return status;
}

async function refreshScoreboard() {
  const season = await getSeason();
  const today = formatDateInTZ(CONFIG.timeZone);
  await withIngestionState("scoreboard", async () => {
    const payload = await apiRequest(
      `/v1/games?season=${season}&date_from=${today}&date_to=${today}&page=1&page_size=200`
    );
    const games = payload.data || [];
    await supabaseUpsert("games", games, "game_id");

    const gameIds = games.map((game) => game.game_id);
    const now = Date.now();
    const staleIds = gameIds.filter((gameId) => {
      const cached = statusCache.get(gameId);
      if (!cached) return true;
      if (activeGameIds.has(gameId)) return false;
      return now - cached.checkedAt > CONFIG.statusRefreshMs;
    });

    await runWithConcurrency(staleIds, CONFIG.boxscoreConcurrency, updateBoxscoreForGame);
    log(`Scoreboard updated: ${games.length} games, ${activeGameIds.size} active`);
  }, { season, date: today });
}

async function refreshActiveGames() {
  if (activeGameIds.size === 0) return;
  await withIngestionState("live_games", async () => {
    const gameIds = Array.from(activeGameIds);
    await runWithConcurrency(gameIds, CONFIG.boxscoreConcurrency, updateBoxscoreForGame);
    log(`Live games refreshed: ${gameIds.length}`);
  }, { active: Array.from(activeGameIds) });
}

async function runWithConcurrency(items, limit, fn) {
  const queue = [...items];
  const workers = new Array(Math.min(limit, queue.length)).fill(null).map(async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) return;
      try {
        await fn(item);
      } catch (error) {
        log("Worker task failed", { item, error: String(error) });
      }
    }
  });
  await Promise.all(workers);
}

function scheduleTask(name, intervalMs, fn, runImmediately = true) {
  let inFlight = false;
  const run = async () => {
    if (inFlight) return;
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

log("Worker starting", {
  apiBaseUrl: CONFIG.apiBaseUrl,
  timeZone: CONFIG.timeZone,
});

scheduleTask("scoreboard", CONFIG.scoreboardIntervalMs, refreshScoreboard, true);
scheduleTask("live-games", CONFIG.livePollIntervalMs, refreshActiveGames, true);
scheduleTask("teams", CONFIG.teamsIntervalMs, refreshTeams, true);
scheduleTask("players", CONFIG.playersIntervalMs, refreshPlayers, true);
scheduleTask("standings", CONFIG.standingsIntervalMs, refreshStandings, true);
scheduleTask("team-stats", CONFIG.teamStatsIntervalMs, refreshTeamStats, true);
