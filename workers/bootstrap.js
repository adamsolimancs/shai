#!/usr/bin/env node
"use strict";

// Explicit current-season pipeline. No historical bios, awards, or playoff sweeps.
process.env.API_MIN_INTERVAL_MS ??= "1500";
process.env.STATS_RETRY_MAX ??= "0";
process.env.STATS_TIMEOUT_MS ??= "10000";
const { Pool } = require("pg");
const nba = require("./worker-live");
const { createSource } = require("./bootstrap-source");
const { cache } = require("./cache");
const { acquireCronLease } = require("./cron-lease");

const SEASON = "2026-27";
const SOURCE = "bootstrap:v1";
const quote = name => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error("Invalid SQL identifier");
  return `"${name}"`;
};
const iso = value => value.toISOString();
const requiredRows = (rows, label) => {
  if (!Array.isArray(rows)) throw new Error(`${label} did not return an array`);
  return rows;
};

async function upsert(client, schema, table, rows, keys) {
  const groups = new Map();
  for (const row of nba.dedupeRowsForConflict(rows, keys.join(","))) {
    const columns = Object.keys(row).sort();
    const signature = columns.join(",");
    if (!groups.has(signature)) groups.set(signature, { columns, rows: [] });
    groups.get(signature).rows.push(row);
  }
  const target = `${quote(schema)}.${quote(table)}`;
  for (const { columns, rows: group } of groups.values()) {
    const names = columns.map(quote).join(", ");
    const updates = columns.filter(column => !keys.includes(column));
    const action = updates.length ? `DO UPDATE SET ${updates.map(c => `${quote(c)}=EXCLUDED.${quote(c)}`).join(",")}` : "DO NOTHING";
    await client.query(`INSERT INTO ${target} (${names}) SELECT ${names} FROM jsonb_populate_recordset(NULL::${target}, $1::jsonb) ON CONFLICT (${keys.map(quote).join(",")}) ${action}`, [JSON.stringify(group)]);
  }
}

class BootstrapStore {
  constructor(pool, schema = "public") {
    quote(schema);
    this.pool = pool;
    this.schema = schema;
    this.stateTable = `${quote(schema)}.ingestion_state`;
  }
  async state(entity) {
    return (await this.pool.query(`SELECT * FROM ${this.stateTable} WHERE source=$1 AND entity=$2`, [SOURCE, entity])).rows[0];
  }
  async record(client, entity, status, cursor, error = null) {
    await client.query(`INSERT INTO ${this.stateTable} (source,entity,status,last_attempt_at,last_success_at,last_cursor,last_error) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (source,entity) DO UPDATE SET status=EXCLUDED.status,last_attempt_at=EXCLUDED.last_attempt_at,last_success_at=COALESCE(EXCLUDED.last_success_at,${this.stateTable}.last_success_at),last_cursor=EXCLUDED.last_cursor,last_error=EXCLUDED.last_error`,
    [SOURCE, entity, status, cursor.attempted_at, status === "ok" ? cursor.completed_at : null, JSON.stringify(cursor), error]);
  }
  async commit(entity, cursor, publish, empty) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${SOURCE}:${entity}`]);
      await publish(client);
      await this.record(client, entity, empty ? "empty" : "ok", cursor);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  async recentGames(season, from, to) {
    return (await this.pool.query(`SELECT game_id FROM ${quote(this.schema)}.games WHERE season=$1 AND date >= $2 AND date <= $3 AND (home_team_score > 0 OR away_team_score > 0) ORDER BY date,game_id`, [nba.seasonToYear(season), from, to])).rows;
  }
}

async function runBootstrap({ store, source, season = SEASON, date = nba.formatDateInTZ("America/New_York"),
  lookbackDays = 2, staticOnly = false, refresh = false, includeLeaders = false, now = () => new Date(), onPublished = async () => {},
  log = value => console.log(JSON.stringify(value)),
}) {
  if (season !== SEASON) throw new Error(`This live-data bootstrap accepts only ${SEASON}; historical imports are disabled`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Error("Invalid bootstrap date");
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 14) throw new Error("lookbackDays must be 1..14");
  const from = iso(new Date(Date.parse(`${date}T12:00:00Z`) - (lookbackDays - 1) * 86400000)).slice(0, 10);
  const year = Number(season.slice(0, 4));
  const gamePrefix = `002${String(year).slice(-2)}`;
  const results = [];
  const publishRows = (client, table, rows, keys) => upsert(client, store.schema, table, rows, keys);
  const playersFor = rows => rows.map(row => {
    const player_id = String(row.PLAYER_ID ?? row.player_id ?? "");
    const full_name = row.PLAYER_NAME ?? row.PLAYER ?? row.player_name;
    if (!/^\d+$/.test(player_id) || !full_name) throw new Error("Player data has missing identity");
    return { player_id, full_name, is_active: "true" };
  });
  async function step(name, fetch, publish, ttlSeconds = 900, allowEmpty = false) {
    const entity = `${season}:${name}`;
    const state = await store.state(entity);
    let previous;
    try { previous = JSON.parse(state?.last_cursor || "{}"); } catch { previous = {}; }
    if (!refresh && state?.status === "ok" && Date.parse(previous.valid_until) > now().getTime()) {
      results.push({ stage: name, status: "skipped", rows: previous.rows });
      log(results.at(-1)); return true;
    }
    const cursor = { version: 1, season, attempted_at: iso(now()), attempts: (previous.attempts || 0) + 1 };
    await store.record(store.pool, entity, "running", cursor);
    try {
      const payload = await fetch();
      const count = Array.isArray(payload) ? payload.length : payload.traditional_players?.length;
      if (!Number.isInteger(count)) throw new Error("Invalid stage response");
      const empty = count === 0 && !allowEmpty;
      const ttl = typeof ttlSeconds === "function" ? ttlSeconds(payload) : ttlSeconds;
      Object.assign(cursor, { completed_at: iso(now()), valid_until: iso(new Date(now().getTime() + ttl * 1000)), rows: count });
      await store.commit(entity, cursor, client => publish(client, payload), empty);
      try { await onPublished(name, payload); } catch { log({ stage: name, cache: "unavailable" }); }
      results.push({ stage: name, status: empty ? "empty" : "ok", rows: count });
      log(results.at(-1)); return !empty;
    } catch (error) {
      await store.record(store.pool, entity, "failed", cursor, error.message);
      results.push({ stage: name, status: "failed", error: error.message });
      log(results.at(-1)); return false;
    }
  }
  if (!await step("teams", async () => {
    const rows = requiredRows(await source.teams(), "teams").map(nba.mapTeamRow);
    if (rows.length !== 30 || new Set(rows.map(row => row?.team_id)).size !== 30 || rows.some(row => !row?.name || !row.abbreviation)) throw new Error("Expected 30 distinct active NBA teams");
    return rows.map(nba.compactObject);
  }, (client, rows) => publishRows(client, "teams", rows, ["team_id"]), 86400)) return { ok: false, results };
  if (!await step("players", async () => {
    const rows = requiredRows(await source.players(), "players").map(nba.mapPlayerRow).filter(row => row?.is_active === "true");
    if (!rows.length || rows.some(row => !/^\d+$/.test(row.player_id) || !row.full_name)) throw new Error("No valid active player directory");
    return rows.map(nba.compactObject);
  }, (client, rows) => publishRows(client, "players", rows, ["player_id"]), 86400)) return { ok: false, results };
  if (staticOnly) return { ok: true, results };

  const validateGames = games => requiredRows(games, "games").map(row => {
    if (!row.game_id?.startsWith(gamePrefix) || !row.date || row.date < `${year}-10-01` || row.date > date) throw new Error("Upstream games do not belong to the requested season/date");
    const mapped = nba.mapGameRow(row, season);
    if (!Number.isInteger(mapped.home_team_id) || !Number.isInteger(mapped.away_team_id)
      || !mapped.home_team_name || !mapped.away_team_name
      || !Number.isFinite(mapped.home_team_score) || !Number.isFinite(mapped.away_team_score)) {
      throw new Error("Upstream game has incomplete teams or scores");
    }
    // Season lists omit tipoff times. Preserve a time observed via the scoreboard
    // or boxscore, while explicitly clearing unknown source-observation evidence.
    return { ...nba.compactObject(mapped), observed_at: mapped.observed_at };
  });
  await step("games", async () => validateGames(await source.games(season)),
    (client, rows) => publishRows(client, "games", rows, ["game_id"]), 60, true);
  await step(`scoreboard:${date}`, async () => validateGames(await source.scoreboard(date, season)),
    (client, rows) => publishRows(client, "games", rows, ["game_id"]), 15, true);
  await step("standings", () => source.standings(season), async (client, rows) => {
    const normalized = requiredRows(rows, "standings").map(row => nba.normalizeLeagueStanding(row));
    await publishRows(client, "league_standings", normalized.map(row => nba.mapLeagueStandingRow(row, season)), ["season", "team_id"]);
    await publishRows(client, "teams", normalized.map(row => nba.compactObject({ team_id: row.team_id, conference: row.conference, division: row.division })), ["team_id"]);
  });
  await step("player_stats", () => source.playerStats(season), async (client, rows) => {
    await publishRows(client, "players", playersFor(rows), ["player_id"]);
    const byPlayer = new Map();
    for (const row of rows) {
      const mapped = nba.mapPlayerSeasonStatsRow(row, season, "Regular Season");
      if (!mapped.team_id) mapped.team_id = null;
      if (!byPlayer.has(mapped.player_id) || Number(row.TEAM_ID) === 0) byPlayer.set(mapped.player_id, mapped);
    }
    await publishRows(client, "player_season_stats", [...byPlayer.values()], ["season", "player_id", "season_type"]);
  });
  await step("team_stats", () => source.teamStats(season), async (client, rows) => {
    const payload = rows.map(row => nba.normalizeServingTeamStatsRow(row));
    await publishRows(client, "api_snapshots", [{ cache_key: `team_stats:${season}:Base:PerGame`, payload: JSON.stringify(payload), updated_at: iso(now()), observed_at: nba.sourceObservedAt(rows) }], ["cache_key"]);
  });
  for (const category of includeLeaders ? ["PTS", "REB", "AST", "STL", "BLK"] : []) {
    await step(`leaders:${category}`, () => source.leaders(season, category), async (client, rows) => {
      await publishRows(client, "players", playersFor(rows), ["player_id"]);
      const mapped = rows.map(row => nba.mapLeagueLeaderRow(row, season, "Regular Season", "PerGame", category));
      for (const row of mapped) if (!row.team_id) row.team_id = null;
      if (mapped.length) await client.query(`DELETE FROM ${quote(store.schema)}.league_leader_rows WHERE season=$1 AND season_type='Regular Season' AND per_mode='PerGame' AND stat_category=$2`, [season, category]);
      await publishRows(client, "league_leader_rows", mapped, ["season", "season_type", "per_mode", "stat_category", "rank", "player_id"]);
    });
  }
  for (const { game_id } of await store.recentGames(season, from, date)) {
    if (!game_id.startsWith(gamePrefix)) continue;
    await step(`boxscore:${game_id}`, () => source.boxscore(game_id), async (client, payload) => {
      if (payload.game_id !== game_id || !payload.observed_at) throw new Error("Invalid source boxscore identity/observation");
      const snapshot = nba.buildGameSnapshotPayload(payload);
      await publishRows(client, "players", playersFor(payload.traditional_players), ["player_id"]);
      await client.query(`SELECT ${quote(store.schema)}.publish_game_snapshot($1::jsonb,$2::jsonb,$3::jsonb)`, [snapshot.p_game, snapshot.p_boxscore, snapshot.p_players].map(value => JSON.stringify(value)));
    }, payload => nba.isFinalStatus(payload.status) ? 21600 : 15);
  }
  return { ok: results.every(row => ["ok", "skipped"].includes(row.status)), results };
}

async function checkSources(source, season = SEASON) {
  const result = {};
  let games = [];
  for (const [name, fetch] of [
    ["games", () => source.games(season)], ["player_stats", () => source.playerStats(season)],
    ["scoreboard", () => source.scoreboard(nba.formatDateInTZ("America/New_York"), season)],
  ]) {
    const start = Date.now();
    try { const rows = requiredRows(await fetch(), name); result[name] = { reachable: true, rows: rows.length, duration_ms: Date.now() - start }; if (name === "games") games = rows; }
    catch (error) { result[name] = { reachable: false, error: error.message }; }
  }
  const latest = games.toSorted((a, b) => b.date.localeCompare(a.date))[0];
  if (latest) {
    try { const box = await source.boxscore(latest.game_id); result.boxscore = { reachable: true, game_id: box.game_id, players: box.traditional_players.length }; }
    catch (error) { result.boxscore = { reachable: false, error: error.message }; }
  }
  return { ok: Boolean(result.games?.reachable && result.player_stats?.reachable && result.scoreboard?.reachable && result.boxscore?.reachable), sources: result };
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  for (const flag of flags) if (!["--static-only", "--check-sources", "--refresh", "--include-leaders"].includes(flag)) throw new Error(`Unknown option: ${flag}`);
  const source = createSource();
  if (flags.has("--check-sources")) {
    const result = await checkSources(source); console.log(JSON.stringify(result));
    process.exitCode = result.ok ? 0 : 1; return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, query_timeout: 30000 });
  let lease;
  try {
    const target = new URL(process.env.DATABASE_URL);
    if (cache) {
      lease = await acquireCronLease(cache, `nba:ingest:cron:${target.hostname}${target.pathname}:${process.env.DATABASE_SCHEMA || "public"}`);
      if (!lease) throw new Error("Another ingestion writer holds the lease; retry later");
    } else if (!target.hostname || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) {
      throw new Error("Remote bootstrap requires the same Redis lease as scheduled ingestion");
    }
    const result = await runBootstrap({ store: new BootstrapStore(pool, process.env.DATABASE_SCHEMA || "public"), source,
      staticOnly: flags.has("--static-only"), refresh: flags.has("--refresh"),
      includeLeaders: flags.has("--include-leaders"),
      onPublished: async (stage) => {
        if (!cache) return;
        // Invalidate affected read caches; cached results must not hide newly seeded rows.
        const prefix = process.env.CACHE_KEY_PREFIX || "nba:serve";
        const patterns = stage.startsWith("boxscore:") ? [`${prefix}:boxscore:${stage.split(":")[1]}`]
          : [`${prefix}:*${SEASON}*`, `team_stats:${SEASON}:*`, "resolver:data*"];
        for (const pattern of patterns) {
          let cursor = "0";
          do { const [next, keys] = await cache.scan(cursor, { match: pattern, count: 200 }); cursor = String(next); if (keys.length) await cache.del(...keys); } while (cursor !== "0");
        }
      },
    });
    console.log(JSON.stringify({ complete: result.ok, season: SEASON }));
    if (!result.ok) process.exitCode = 1;
  } finally {
    try { if (lease) await lease.release(); }
    finally { await pool.end(); }
  }
}
if (require.main === module) main().catch(error => { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }).finally(() => nba.closeWorkerResources());
module.exports = { runBootstrap, BootstrapStore, upsert, checkSources, SEASON };
