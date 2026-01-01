#!/usr/bin/env node
"use strict";

if (typeof fetch !== "function") {
  console.error("This worker requires Node.js 18+ (global fetch).");
  process.exit(1);
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
  timeZone: process.env.NBA_TIME_ZONE || "America/New_York",
  cronMinIntervalMs: Number(process.env.CRON_MIN_INTERVAL_MS || 60 * 1000),
  gamesIntervalMs: Number(process.env.GAMES_INTERVAL_MS || 6 * 60 * 60 * 1000),
  livePollIntervalMs: Number(process.env.LIVE_GAMES_INTERVAL_MS || 5000),
  scoreboardIntervalMs: Number(process.env.SCOREBOARD_INTERVAL_MS || 10000),
  teamsIntervalMs: Number(process.env.TEAMS_INTERVAL_MS || 6 * 60 * 60 * 1000),
  playersIntervalMs: Number(process.env.PLAYERS_INTERVAL_MS || 6 * 60 * 60 * 1000),
  standingsIntervalMs: Number(process.env.STANDINGS_INTERVAL_MS || 15 * 60 * 1000),
  playerStatsIntervalMs: Number(process.env.PLAYER_STATS_INTERVAL_MS || 6 * 60 * 60 * 1000),
  teamStatsIntervalMs: Number(process.env.TEAM_STATS_INTERVAL_MS || 60 * 60 * 1000),
  teamDetailsIntervalMs: Number(process.env.TEAM_DETAILS_INTERVAL_MS || 24 * 60 * 60 * 1000),
  teamGameLogsIntervalMs: Number(process.env.TEAM_GAME_LOGS_INTERVAL_MS || 6 * 60 * 60 * 1000),
  teamGameLogsSeasonsBack: Number(process.env.TEAM_GAME_LOGS_SEASONS_BACK || 1),
  playerAwardsIntervalMs: Number(process.env.PLAYER_AWARDS_INTERVAL_MS || 24 * 60 * 60 * 1000),
  playerAwardsActiveOnly: parseBoolean(process.env.PLAYER_AWARDS_ACTIVE_ONLY, true),
  playerGameLogsIntervalMs: Number(process.env.PLAYER_GAME_LOGS_INTERVAL_MS || 24 * 60 * 60 * 1000),
  playerGameLogsSeasonsBack: Number(process.env.PLAYER_GAME_LOGS_SEASONS_BACK || 1),
  playerGameLogsActiveOnly: parseBoolean(process.env.PLAYER_GAME_LOGS_ACTIVE_ONLY, true),
  playerGameLogsMaxPlayers: Number(process.env.PLAYER_GAME_LOGS_MAX_PLAYERS || 0),
  boxscoreBackfillIntervalMs: Number(
    process.env.BOXSCORE_BACKFILL_INTERVAL_MS || 60 * 60 * 1000
  ),
  boxscoreLookbackDays: Number(process.env.BOXSCORE_LOOKBACK_DAYS || 7),
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
let cachedSupportedSeasons = null;
let cachedSupportedSeasonsAt = 0;

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

async function getIngestionState(entity) {
  const rows = await supabaseSelect("ingestion_state", {
    select: "last_success_at",
    source: "eq.nba_api",
    entity: `eq.${entity}`,
    limit: 1,
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
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

async function getSeasonsToSync() {
  const supported = await getSupportedSeasons();
  const seasonSet = new Set();
  const currentSeason = await getSeason();
  seasonSet.add(currentSeason);

  const manualSeasons = parseSeasonList(CONFIG.historicSeasons);
  manualSeasons.forEach((season) => seasonSet.add(season));

  if (CONFIG.historicSeasonsBack > 0) {
    const recent = supported.slice(-CONFIG.historicSeasonsBack);
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

async function getRecentSeasons(count) {
  const supported = await getSupportedSeasons();
  const currentSeason = await getSeason();
  const currentIndex = supported.indexOf(currentSeason);
  if (currentIndex === -1) {
    return supported.slice(-Math.max(1, count));
  }
  const start = Math.max(0, currentIndex - Math.max(1, count) + 1);
  return supported.slice(start, currentIndex + 1);
}

async function fetchTeamsForSeason(season) {
  const payload = await apiRequest(`/v1/teams?season=${season}`);
  return payload.data || [];
}

async function fetchPlayerIds(season, { activeOnly = false, maxPlayers = 0 } = {}) {
  let page = 1;
  const pageSize = 200;
  const players = [];
  const activeParam = activeOnly ? "&active=true" : "";
  while (true) {
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
    await supabaseUpsert("teams", payload.data, "id");
    log(`Upserted ${payload.data.length} teams`);
  }, { season });
}

async function refreshGames() {
  const seasons = await getSeasonsToSync();
  await withIngestionState("games", async () => {
    for (const season of seasons) {
      let page = 1;
      const pageSize = 200;
      let total = 0;
      while (true) {
        const payload = await apiRequest(
          `/v1/games?season=${season}&page=${page}&page_size=${pageSize}`
        );
        const rows = payload.data || [];
        if (rows.length) {
          await supabaseUpsert("games", rows, "game_id");
          total += rows.length;
        }
        const nextPage = payload.meta?.pagination?.next;
        if (!nextPage) break;
        page = nextPage;
      }
      log(`Upserted ${total} games for ${season}`);
    }
  }, { seasons });
}

async function refreshPlayersForSeason(season) {
  let page = 1;
  const pageSize = 200;
  let total = 0;
  while (true) {
    const payload = await apiRequest(
      `/v1/players?season=${season}&page=${page}&page_size=${pageSize}`
    );
    const rows = payload.data || [];
    if (rows.length) {
      await supabaseUpsert("players", rows, "id");
      total += rows.length;
    }
    const nextPage = payload.meta?.pagination?.next;
    if (!nextPage) break;
    page = nextPage;
  }
  log(`Upserted ${total} players for ${season}`);
}

async function refreshPlayers() {
  const seasons = await getSeasonsToSync();
  await withIngestionState("players", async () => {
    for (const season of seasons) {
      await refreshPlayersForSeason(season);
    }
  }, { seasons });
}

async function refreshStandings() {
  const seasons = await getSeasonsToSync();
  await withIngestionState("league_standings", async () => {
    for (const season of seasons) {
      const payload = await apiRequest(`/v1/league_standings?season=${season}`);
      const rows = (payload.data || []).map((row) => ({ ...row, season }));
      await supabaseUpsert("league_standings", rows, "season,team_id");
      log(`Upserted ${rows.length} league standings for ${season}`);
    }
  }, { seasons });
}

async function refreshTeamStats() {
  const seasons = await getSeasonsToSync();
  await withIngestionState("team_stats", async () => {
    for (const season of seasons) {
      const payload = await apiRequest(`/v1/teams/stats?season=${season}`);
      const rows = (payload.data || []).map((row) => ({ ...row, season }));
      await supabaseUpsert("team_stats", rows, "season,team_id");
      log(`Upserted ${rows.length} team stats for ${season}`);
    }
  }, { seasons });
}

async function refreshTeamDetails() {
  const season = await getSeason();
  await withIngestionState("team_details", async () => {
    const teams = await fetchTeamsForSeason(season);
    await runWithConcurrency(teams, CONFIG.boxscoreConcurrency, async (team) => {
      const payload = await apiRequest(`/v1/teams/${team.id}/details`);
      const detail = payload.data || {};
      const row = detail.team_id ? detail : { ...detail, team_id: team.id };
      await supabaseUpsert("team_details", [row], "team_id");
    });
    log(`Upserted ${teams.length} team details`);
  }, { season });
}

async function refreshTeamGameLogs() {
  const seasons = await getRecentSeasons(CONFIG.teamGameLogsSeasonsBack);
  const currentSeason = await getSeason();
  const teams = await fetchTeamsForSeason(currentSeason);
  const tasks = [];
  for (const season of seasons) {
    for (const team of teams) {
      tasks.push({ season, teamId: team.id });
    }
  }
  await withIngestionState("team_game_logs", async () => {
    await runWithConcurrency(tasks, CONFIG.boxscoreConcurrency, async (task) => {
      let page = 1;
      const pageSize = 200;
      let total = 0;
      while (true) {
        const payload = await apiRequest(
          `/v1/games?season=${task.season}&team_id=${task.teamId}&per_team=true&page=${page}&page_size=${pageSize}`
        );
        const rows = payload.data || [];
        if (rows.length) {
          await supabaseUpsert("team_game_logs", rows, "game_id,team_id");
          total += rows.length;
        }
        const nextPage = payload.meta?.pagination?.next;
        if (!nextPage) break;
        page = nextPage;
      }
      log(`Upserted ${total} team game logs for ${task.season} team ${task.teamId}`);
    });
  }, { seasons, team_count: teams.length });
}

async function refreshPlayerAwards() {
  const season = await getSeason();
  const playerIds = await fetchPlayerIds(season, {
    activeOnly: CONFIG.playerAwardsActiveOnly,
  });
  await withIngestionState("player_awards", async () => {
    await runWithConcurrency(playerIds, CONFIG.boxscoreConcurrency, async (playerId) => {
      const payload = await apiRequest(`/v1/players/${playerId}/awards`);
      const rows = (payload.data || []).map((row) => ({ ...row, player_id: playerId }));
      if (rows.length) {
        await supabaseUpsert("player_awards", rows, "player_id,season,description");
      }
    });
    log(`Upserted player awards for ${playerIds.length} players`);
  }, { season, player_count: playerIds.length });
}

async function refreshPlayerGameLogs() {
  const seasons = await getRecentSeasons(CONFIG.playerGameLogsSeasonsBack);
  const currentSeason = await getSeason();
  const playerIds = await fetchPlayerIds(currentSeason, {
    activeOnly: CONFIG.playerGameLogsActiveOnly,
    maxPlayers: CONFIG.playerGameLogsMaxPlayers,
  });
  await withIngestionState("player_game_logs", async () => {
    await runWithConcurrency(playerIds, CONFIG.boxscoreConcurrency, async (playerId) => {
      for (const season of seasons) {
        const payload = await apiRequest(`/v1/players/${playerId}/gamelog?season=${season}`);
        const rows = (payload.data || []).map((row) => ({ ...row, player_id: playerId }));
        if (rows.length) {
          await supabaseUpsert("player_game_logs", rows, "player_id,game_id");
        }
      }
    });
    log(`Upserted player game logs for ${playerIds.length} players`);
  }, { seasons, player_count: playerIds.length });
}

async function refreshPlayerSeasonStatsForSeason(season) {
  let page = 1;
  const pageSize = 200;
  let total = 0;
  while (true) {
    const payload = await apiRequest(
      `/v1/players/stats?season=${season}&page=${page}&page_size=${pageSize}`
    );
    const rows = (payload.data || []).map((row) => ({ ...row, season }));
    if (rows.length) {
      await supabaseUpsert("player_season_stats", rows, "season,player_id");
      total += rows.length;
    }
    const nextPage = payload.meta?.pagination?.next;
    if (!nextPage) break;
    page = nextPage;
  }
  log(`Upserted ${total} player season stats for ${season}`);
}

async function refreshPlayerSeasonStats() {
  const seasons = await getSeasonsToSync();
  await withIngestionState("player_season_stats", async () => {
    for (const season of seasons) {
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

async function refreshScoreboard({ mode = CONFIG.workerMode } = {}) {
  const season = await getSeason();
  const today = formatDateInTZ(CONFIG.timeZone);
  await withIngestionState("scoreboard", async () => {
    const payload = await apiRequest(
      `/v1/games?season=${season}&date_from=${today}&date_to=${today}&page=1&page_size=200`
    );
    const games = payload.data || [];
    await supabaseUpsert("games", games, "game_id");

    const gameIds = games.map((game) => game.game_id);
    if (mode === "cron") {
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
    await runWithConcurrency(gameIds, CONFIG.boxscoreConcurrency, updateBoxscoreForGame);
    log(`Backfilled ${gameIds.length} boxscores from ${dateFrom} to ${dateTo}`);
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

async function runCron() {
  if (await shouldRun("scoreboard", CONFIG.scoreboardIntervalMs)) {
    await refreshScoreboard({ mode: "cron" });
  }
  if (await shouldRun("games", CONFIG.gamesIntervalMs)) {
    await refreshGames();
  }
  if (await shouldRun("players", CONFIG.playersIntervalMs)) {
    await refreshPlayers();
  }
  if (await shouldRun("league_standings", CONFIG.standingsIntervalMs)) {
    await refreshStandings();
  }
  if (await shouldRun("player_awards", CONFIG.playerAwardsIntervalMs)) {
    await refreshPlayerAwards();
  }
  if (await shouldRun("player_game_logs", CONFIG.playerGameLogsIntervalMs)) {
    await refreshPlayerGameLogs();
  }
  if (await shouldRun("player_season_stats", CONFIG.playerStatsIntervalMs)) {
    await refreshPlayerSeasonStats();
  }
  if (await shouldRun("team_stats", CONFIG.teamStatsIntervalMs)) {
    await refreshTeamStats();
  }
  if (await shouldRun("team_details", CONFIG.teamDetailsIntervalMs)) {
    await refreshTeamDetails();
  }
  if (await shouldRun("team_game_logs", CONFIG.teamGameLogsIntervalMs)) {
    await refreshTeamGameLogs();
  }
  if (await shouldRun("boxscores", CONFIG.boxscoreBackfillIntervalMs)) {
    await refreshRecentBoxscores();
  }
}

async function runLive() {
  scheduleTask("scoreboard", CONFIG.scoreboardIntervalMs, refreshScoreboard, true);
  scheduleTask("live-games", CONFIG.livePollIntervalMs, refreshActiveGames, true);
  scheduleTask("teams", CONFIG.teamsIntervalMs, refreshTeams, true);
  scheduleTask("players", CONFIG.playersIntervalMs, refreshPlayers, true);
  scheduleTask("standings", CONFIG.standingsIntervalMs, refreshStandings, true);
  scheduleTask("player-awards", CONFIG.playerAwardsIntervalMs, refreshPlayerAwards, true);
  scheduleTask("player-game-logs", CONFIG.playerGameLogsIntervalMs, refreshPlayerGameLogs, true);
  scheduleTask("player-season-stats", CONFIG.playerStatsIntervalMs, refreshPlayerSeasonStats, true);
  scheduleTask("team-stats", CONFIG.teamStatsIntervalMs, refreshTeamStats, true);
  scheduleTask("team-details", CONFIG.teamDetailsIntervalMs, refreshTeamDetails, true);
  scheduleTask("team-game-logs", CONFIG.teamGameLogsIntervalMs, refreshTeamGameLogs, true);
  scheduleTask("boxscores-backfill", CONFIG.boxscoreBackfillIntervalMs, refreshRecentBoxscores, true);
}

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
