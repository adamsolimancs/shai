#!/usr/bin/env node
"use strict";

process.env.STATS_TIMEOUT_MS ??= "5000";
process.env.STATS_RETRY_MAX = "0";
process.env.API_MIN_INTERVAL_MS ??= "1500";

const { execFile } = require("node:child_process");
const { join } = require("node:path");
const { promisify } = require("node:util");
const { Pool } = require("pg");
const nba = require("./worker-live");
const { buildBoxscoreSnapshot, upsert, BootstrapStore, SEASON } = require("./bootstrap");
const { createSource } = require("./bootstrap-source");
const { acquireCronLease } = require("./cron-lease");
const { cache } = require("./cache");

const runFile = promisify(execFile);
const entity = `${SEASON}:morning`;
const seasonYear = Number(SEASON.slice(0, 4));

async function loadNba(source, today) {
  const games = await source.games(SEASON);
  const completed = games.filter(game => game.date < today && game.home_team_score > 0 && game.away_team_score > 0);
  const dates = Array.from(new Set(completed.map(game => game.date))).sort().slice(-3);
  const selected = completed.filter(game => dates.includes(game.date));
  if (!selected.length || dates.at(-1) < new Date(Date.parse(today) - 3 * 86400000).toISOString().slice(0, 10)) {
    throw new Error("NBA Stats has no recent completed slate");
  }

  const standings = await source.standings(SEASON);
  const playerStats = await source.playerStats(SEASON);
  const boxes = [];
  for (const game of selected) {
    const box = await source.boxscore(game.game_id);
    if (box.game_date !== game.date || box.home_team?.team_id !== game.home_team_id ||
        box.away_team?.team_id !== game.away_team_id || box.home_team.score !== game.home_team_score ||
        box.away_team.score !== game.away_team_score) {
      throw new Error(`NBA Stats game list and box score disagree for ${game.game_id}`);
    }
    boxes.push(box);
  }
  return { standings, playerStats, boxes };
}

async function loadArchive(today) {
  const { stdout } = await runFile(
    process.env.PYTHON_BIN || "python3",
    [join(__dirname, "morning-archive.py"), today, String(seasonYear + 1)],
    { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

function prepareBatch({ standings, playerStats, boxes }, today) {
  const teamRows = standings.map(row => nba.mapLeagueStandingRow(nba.normalizeLeagueStanding(row), SEASON));
  const knownTeams = new Set(teamRows.map(row => row?.team_id));
  if (teamRows.length !== 30 || knownTeams.size !== 30 ||
      teamRows.some(row => !row?.team_id || !Number.isInteger(row.wins) || !Number.isInteger(row.losses) ||
        row.wins < 0 || row.losses < 0 || !row.conference || !row.conference_rank)) {
    throw new Error("Expected 30 distinct teams with valid standings");
  }

  const playerRows = new Map();
  const playerDirectory = new Map();
  const addPlayer = (id, name) => {
    const playerId = String(id ?? "");
    if (!/^\d+$/.test(playerId) || Number(playerId) <= 0 || !name?.trim()) {
      throw new Error("Missing NBA player identity");
    }
    if (!playerDirectory.has(playerId)) playerDirectory.set(playerId, { player_id: playerId, full_name: name.trim(), is_active: "true" });
  };
  for (const row of playerStats) {
    addPlayer(row.PLAYER_ID, row.PLAYER_NAME);
    const mapped = nba.mapPlayerSeasonStatsRow(row, SEASON, "Regular Season");
    mapped.team_id = Number(mapped.team_id) || undefined;
    if (!Number.isInteger(mapped.games_played) || mapped.games_played < 1 ||
        !Number.isFinite(mapped.points_pg) || mapped.points_pg < 0 ||
        (mapped.team_id && !knownTeams.has(mapped.team_id))) {
      throw new Error(`Invalid season stats for NBA player ${mapped.player_id}`);
    }
    if (!playerRows.has(mapped.player_id) || !mapped.team_id) {
      playerRows.set(mapped.player_id, nba.compactObject(mapped));
    }
  }
  if (playerRows.size < 300) throw new Error("Player season coverage looks incomplete");

  const seen = new Set();
  const snapshots = boxes.map(box => {
    if (!box.game_id?.startsWith(`002${String(seasonYear).slice(-2)}`) || seen.has(box.game_id) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(box.game_date) || box.game_date < `${seasonYear}-10-01` ||
        box.game_date >= today || !nba.isFinalStatus(box.status) ||
        !Number.isFinite(Date.parse(box.observed_at)) || !knownTeams.has(box.home_team?.team_id) ||
        !knownTeams.has(box.away_team?.team_id) || box.home_team.score === box.away_team.score) {
      throw new Error(`Invalid completed box score for ${box.game_id}`);
    }
    seen.add(box.game_id);
    for (const row of box.traditional_players) addPlayer(row.player_id, row.player_name);
    return buildBoxscoreSnapshot(box, box.game_id);
  });
  if (!snapshots.length) throw new Error("No completed box scores in the publication batch");

  return { teamRows, playerRows: [...playerRows.values()], playerDirectory: [...playerDirectory.values()], snapshots };
}

async function verifiedGames(client, schema, ids) {
  const { rows } = await client.query(`
    SELECT g.game_id, g.date, g.home_team_id, g.away_team_id, g.home_team_score, g.away_team_score, b.observed_at,
           b.home_team::jsonb->>'score' = g.home_team_score::text AND
           b.away_team::jsonb->>'score' = g.away_team_score::text AND
           totals.home_points = g.home_team_score AND totals.away_points = g.away_team_score AS reconciled
    FROM "${schema}".games g JOIN "${schema}".boxscores b USING (game_id)
    CROSS JOIN LATERAL (
      SELECT SUM(p.points) FILTER (WHERE p.team_id = g.home_team_id) AS home_points,
             SUM(p.points) FILTER (WHERE p.team_id = g.away_team_id) AS away_points
      FROM "${schema}".boxscore_players p WHERE p.game_id = g.game_id
    ) totals
    WHERE g.game_id = ANY($1::text[]) AND b.status ILIKE '%final%'
      AND g.home_team_score > 0 AND g.away_team_score > 0`, [ids]);
  return new Map(rows.filter(row => row.reconciled).map(row => [row.game_id, row]));
}

function sameGame(stored, incoming) {
  return stored.date === incoming.date &&
    Number(stored.home_team_id) === incoming.home_team_id &&
    Number(stored.away_team_id) === incoming.away_team_id;
}

async function publish(pool, schema, source, batch, runId, today) {
  const store = new BootstrapStore(pool, schema);
  const attempted = new Date().toISOString();
  const ids = batch.snapshots.map(({ p_game }) => p_game.game_id);
  const teams = (await nba.fetchStaticTeams()).map(nba.mapTeamRow).filter(Boolean);
  if (teams.length !== 30 || batch.teamRows.some(row => !teams.some(team => team.team_id === row.team_id))) {
    throw new Error("NBA team directory does not cover the standings");
  }
  const client = await pool.connect();
  let result;
  try {
    await client.query("BEGIN");
    const references = batch.teamRows.map(({ team_id, conference, division }) => ({ team_id, conference, division }));
    await upsert(client, schema, "teams", teams.map(nba.compactObject), ["team_id"], "false");
    await upsert(client, schema, "teams", references, ["team_id"]);
    await upsert(client, schema, "players", batch.playerDirectory, ["player_id"],
      "stored.full_name IS NULL OR stored.full_name = ''");

    const standings = await upsert(client, schema, "league_standings", batch.teamRows, ["season", "team_id"],
      "excluded.wins + excluded.losses >= coalesce(stored.wins, 0) + coalesce(stored.losses, 0)");
    const players = await upsert(client, schema, "player_season_stats", batch.playerRows,
      ["season", "player_id", "season_type"], "excluded.games_played >= coalesce(stored.games_played, 0)");

    const existing = await verifiedGames(client, schema, ids);
    const publishedBoxes = [];
    for (const snapshot of batch.snapshots) {
      const { p_game: game, p_boxscore: box, p_players: lines } = snapshot;
      const prior = existing.get(game.game_id);
      if (prior && !sameGame(prior, game)) throw new Error(`NBA game identity changed for ${game.game_id}`);
      if (prior && source === "hoopr") {
        const sameScore = prior.home_team_score === game.home_team_score && prior.away_team_score === game.away_team_score;
        if (sameScore || (prior.observed_at && prior.observed_at >= new Date(game.observed_at))) continue;
        throw new Error(`Archive and stored final score disagree for ${game.game_id}`);
      }
      if (prior?.observed_at && prior.observed_at >= new Date(game.observed_at)) continue;
      await client.query(`SELECT "${schema}".publish_game_snapshot($1::jsonb, $2::jsonb, $3::jsonb)`,
        [game, box, lines].map(value => JSON.stringify(value)));
      publishedBoxes.push(game.game_id);
    }
    const verified = await verifiedGames(client, schema, ids);
    if (verified.size !== ids.length) throw new Error("Stored finals do not reconcile with their player box scores");
    result = {
      source, run_id: runId, date: today,
      latest_slate: batch.snapshots.map(({ p_game }) => p_game.date).sort().at(-1),
      scores_and_boxscores_written: publishedBoxes.length,
      scores_and_boxscores_verified: verified.size,
      standings_written: standings, standings_verified: batch.teamRows.length,
      player_stats_written: players, player_stats_verified: batch.playerRows.length,
      box_ids: ids,
      slate_dates: [...new Set(batch.snapshots.map(({ p_game }) => p_game.date))].sort(),
    };
    await store.record(client, entity, "ok", {
      attempted_at: attempted, completed_at: new Date().toISOString(), ...result,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const persisted = await store.state(entity);
  const counts = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM "${schema}".league_standings
        WHERE season = $1 AND team_id = ANY($2::bigint[])) AS standings,
      (SELECT COUNT(*)::int FROM "${schema}".player_season_stats
        WHERE season = $1 AND season_type = 'Regular Season' AND player_id = ANY($3::text[])) AS players`,
  [SEASON, batch.teamRows.map(row => row.team_id), batch.playerRows.map(row => row.player_id)]);
  if (persisted?.status !== "ok" || JSON.parse(persisted.last_cursor).run_id !== runId ||
      counts.rows[0].standings !== result.standings_verified ||
      counts.rows[0].players !== result.player_stats_verified ||
      (await verifiedGames(pool, schema, ids)).size !== ids.length) {
    throw new Error("Committed scores, standings or player stats could not be verified");
  }
  return result;
}

async function invalidate(result) {
  const prefix = (process.env.CACHE_KEY_PREFIX || "nba:serve").replace(/:+$/, "");
  const keys = [
    ...result.box_ids.map(id => `${prefix}:boxscore:v2:${id}`),
    ...result.slate_dates.map(date => `${prefix}:scoreboard:${date}`),
  ];
  const patterns = [`${prefix}:standings:${SEASON}:*`, `${prefix}:player_stats:${SEASON}:*`,
    `${prefix}:player_gamelog:*:${SEASON}:*`];
  const staleKeys = keys.flatMap(key => [key, `${key}:stale`, `${key}:observation:v1`, `${key}:observation:v1:stale`]);
  if (staleKeys.length) await cache.del(...staleKeys);
  for (const pattern of patterns) {
    let cursor = "0";
    do {
      const [next, matches] = await cache.scan(cursor, { match: pattern, count: 200 });
      cursor = String(next);
      const values = matches.filter(key => !key.endsWith(":lock"));
      if (values.length) await cache.del(...values);
    } while (cursor !== "0");
  }
}

async function main() {
  const today = nba.formatDateInTZ("America/New_York");
  const args = new Set(process.argv.slice(2));
  if ([...args].some(arg => !["--archive-only", "--check"].includes(arg))) throw new Error("Unknown morning import option");
  let source = "nba_api";
  let batch;
  if (!args.has("--archive-only")) {
    try {
      batch = prepareBatch(await loadNba(createSource(), today), today);
    } catch (error) {
      console.log(JSON.stringify({ event: "nba_fallback", reason: error.message }));
    }
  }
  if (!batch) {
    source = "hoopr";
    batch = prepareBatch(await loadArchive(today), today);
  }
  if (process.env.EXPECTED_SLATE && !batch.snapshots.some(({ p_game }) => p_game.date === process.env.EXPECTED_SLATE)) {
    throw new Error("Requested slate is absent from the verified batch");
  }
  if (args.has("--check")) {
    console.log(JSON.stringify({ source, standings: batch.teamRows.length, players: batch.playerRows.length, boxes: batch.snapshots.length }));
    return;
  }

  if (!process.env.DATABASE_URL || !cache) throw new Error("Database and Redis writer credentials are required");
  const schema = process.env.DATABASE_SCHEMA || "public";
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("Invalid database schema");
  const target = new URL(process.env.DATABASE_URL);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000, query_timeout: 30_000 });
  let lease;
  try {
    lease = await acquireCronLease(cache, `nba:ingest:cron:${target.hostname}${target.pathname}:${schema}`);
    if (!lease) throw new Error("Another ingestion writer holds the lease");
    const runId = process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_RUN_ID}:${process.env.GITHUB_RUN_ATTEMPT}`
      : `local:${new Date().toISOString()}`;
    const result = await publish(pool, schema, source, batch, runId, today);
    await invalidate(result);
    const { box_ids, ...summary } = result;
    console.log(JSON.stringify({ event: "verified_publication", ...summary }));
  } finally {
    try { if (lease) await lease.release(); }
    finally { await pool.end(); }
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({ event: "morning_failed", error: error.message }));
    process.exitCode = 1;
  }).finally(() => nba.closeWorkerResources());
}
module.exports = { prepareBatch, loadNba, publish };
