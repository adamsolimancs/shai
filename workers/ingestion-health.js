#!/usr/bin/env node
"use strict";

// Deliberately independent of the writer, NBA bridge, Redis and cache modules.
const { Pool } = require("pg");
const { SEASON, SOURCE } = require("./bootstrap-config");
const { isFinalStatus, finalScoreIssue } = require("./boxscore-coverage");
const HOURS = 3600;
const POLICY = Object.freeze({ live_max_age_seconds: 6 * HOURS, final_boxscore_max_age_seconds: 24 * HOURS,
  directory_max_age_seconds: 48 * HOURS, future_tolerance_seconds: 300, lookback_days: 2 });
const timestamp = value => {
  if (!value) return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time.toISOString();
};
const parse = value => {
  try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return null; }
};
function reportDate(now) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

async function readInventory(pool, schema = "public") {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("Invalid database schema");
  const table = name => `"${schema}".${name}`;
  const client = await pool.connect();
  try {
    // Counts, observations and checkpoints must describe the same publication.
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const counts = (await client.query(`SELECT
      (SELECT count(*)::int FROM ${table("teams")}) AS teams,
      (SELECT count(*)::int FROM ${table("players")}) AS players,
      (SELECT count(*)::int FROM ${table("players")} WHERE lower(is_active)='true') AS active_players,
      (SELECT count(*)::int FROM ${table("player_season_stats")} WHERE season=$1 AND season_type='Regular Season') AS player_stats`, [SEASON])).rows[0];
    const games = (await client.query(`SELECT g.game_id,g.date,g.observed_at,g.home_team_score,g.away_team_score,
      b.game_id AS boxscore_id,b.status AS boxscore_status,b.observed_at AS boxscore_observed_at,
      b.home_team AS boxscore_home_team,b.away_team AS boxscore_away_team,
      COALESCE(players.lines, 0)::int AS player_lines,COALESCE(players.totals,'[]'::jsonb) AS player_point_totals
      FROM ${table("games")} g LEFT JOIN ${table("boxscores")} b USING (game_id)
      LEFT JOIN LATERAL (
        SELECT sum(line_count) AS lines,
          jsonb_agg(jsonb_build_object('team_id',team_id,'points',points)) FILTER (WHERE points IS NOT NULL) AS totals
        FROM (SELECT team_id,count(*) AS line_count,sum(points) AS points
          FROM ${table("boxscore_players")} WHERE game_id=g.game_id GROUP BY team_id) AS by_team
      ) players ON true
      WHERE g.season=$1 ORDER BY g.date,g.game_id`, [Number(SEASON.slice(0, 4))])).rows;
    const standings = (await client.query(`SELECT team_id FROM ${table("league_standings")} WHERE season=$1 ORDER BY team_id`, [SEASON])).rows;
    const snapshot = (await client.query(`SELECT payload,observed_at FROM ${table("api_snapshots")} WHERE cache_key=$1`, [`team_stats:${SEASON}:Base:PerGame`])).rows[0] || null;
    const states = (await client.query(`SELECT entity,status,last_attempt_at,last_success_at,last_cursor
      FROM ${table("ingestion_state")} WHERE source=$1 AND entity LIKE $2 ORDER BY entity`, [SOURCE, `${SEASON}:%`])).rows;
    await client.query("COMMIT");
    return { counts, games, standings, snapshot, states };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

function buildReport(inventory, now = new Date()) {
  const date = reportDate(now);
  const from = new Date(Date.parse(`${date}T12:00:00Z`) - (POLICY.lookback_days - 1) * 86400000).toISOString().slice(0, 10);
  const issues = [];
  const issue = (code, scope) => issues.push({ code, scope });
  const age = value => value ? Math.floor((now.getTime() - Date.parse(value)) / 1000) : null;
  const fresh = (value, limit) => {
    const seconds = age(timestamp(value));
    return seconds !== null && seconds >= -POLICY.future_tolerance_seconds && seconds <= limit;
  };
  function observations(values, limit) {
    const times = values.map(timestamp);
    const valid = times.filter(Boolean).sort();
    return { oldest_observed_at: valid[0] || null, latest_observed_at: valid.at(-1) || null,
      missing: times.filter(value => !value).length,
      stale: valid.filter(value => age(value) > limit).length,
      future: valid.filter(value => age(value) < -POLICY.future_tolerance_seconds).length };
  }
  const states = new Map(inventory.states.map(row => [row.entity.slice(SEASON.length + 1), row]));
  const played = game => Number(game.home_team_score) > 0 || Number(game.away_team_score) > 0;
  const recent = inventory.games.filter(game => game.date >= from && game.date <= date);
  const due = recent.filter(played);
  const seasonPlayed = inventory.games.filter(played);
  const gamesState = states.get("games");
  const boardState = states.get(`scoreboard:${date}`);
  const verifiedNoPlay = seasonPlayed.length === 0 && gamesState?.status === "ok" && boardState?.status === "ok"
    && fresh(gamesState.last_success_at, POLICY.live_max_age_seconds) && fresh(boardState.last_success_at, POLICY.live_max_age_seconds);
  const stages = [];
  function stage(name, { directory = false, allowEmpty = false, maxAge = POLICY.live_max_age_seconds } = {}) {
    const row = states.get(name);
    const cursor = parse(row?.last_cursor);
    const empty = allowEmpty && verifiedNoPlay && row?.status === "empty";
    const publishedAt = timestamp(empty ? cursor?.completed_at : row?.last_success_at);
    if (directory) maxAge = POLICY.directory_max_age_seconds;
    const health = !row ? "missing" : row.status !== "ok" && !empty ? row.status || "unknown"
      : !fresh(publishedAt, maxAge) ? "stale" : "healthy";
    stages.push({ stage: name, status: row?.status || "missing", health,
      last_attempt_at: timestamp(row?.last_attempt_at), last_success_at: timestamp(row?.last_success_at),
      // A failed cursor can contain completed_at before its transaction rolled back.
      // Only successful/empty committed states establish a publication.
      last_published_at: row?.status === "ok" || empty ? publishedAt : null,
      freshness_basis: "checkpoint_publication", source_observed_at: null });
    if (health !== "healthy") issue(`stage_${health}`, name);
  }
  stage("teams", { directory: true });
  stage("players", { directory: true });
  stage("games");
  stage(`scoreboard:${date}`);
  for (const name of ["standings", "player_stats", "team_stats"]) stage(name, { allowEmpty: true });
  // Final snapshots have a longer correction window than live snapshots.
  for (const game of due) {
    stage(`boxscore:${game.game_id}`, { maxAge: isFinalStatus(game.boxscore_status)
      ? POLICY.final_boxscore_max_age_seconds : POLICY.live_max_age_seconds });
  }
  if (inventory.counts.teams < 30) issue("incomplete_directory", "teams");
  if (!inventory.counts.active_players) issue("empty_directory", "players");
  const payload = parse(inventory.snapshot?.payload);
  const snapshotValid = Array.isArray(payload) && payload.every(row => row && Number.isInteger(Number(row.team_id)) && Number(row.team_id) > 0);
  const teamIds = snapshotValid ? [...new Set(payload.map(row => Number(row.team_id)))].sort((a, b) => a - b) : [];
  const standingsIds = new Set(inventory.standings.map(row => Number(row.team_id)));
  if (!snapshotValid && inventory.snapshot) issue("invalid_snapshot", "team_stats");
  if (!verifiedNoPlay) {
    if (standingsIds.size < 30) issue("incomplete_coverage", "standings");
    if (teamIds.length < 30) issue("incomplete_coverage", "team_stats");
    if (!inventory.counts.player_stats) issue("empty_coverage", "player_stats");
  }
  if ([...standingsIds].some(id => !teamIds.includes(id))) issue("team_ids_mismatch", "team_stats");
  const recentObservations = observations(recent.map(game => game.observed_at), POLICY.live_max_age_seconds);
  if (recentObservations.missing || recentObservations.stale || recentObservations.future) issue("unfresh_observations", "recent_games");
  if (teamIds.length && !fresh(inventory.snapshot.observed_at, POLICY.live_max_age_seconds)) issue("unfresh_observations", "team_stats");
  const missingBoxes = due.filter(game => !game.boxscore_id).map(game => game.game_id);
  const missingLines = due.filter(game => game.boxscore_id && !game.player_lines).map(game => game.game_id);
  const unfreshBoxes = due.filter(game => game.boxscore_id && !fresh(game.boxscore_observed_at,
    isFinalStatus(game.boxscore_status) ? POLICY.final_boxscore_max_age_seconds : POLICY.live_max_age_seconds)).map(game => game.game_id);
  for (const [ids, code] of [[missingBoxes, "missing_boxscores"], [missingLines, "missing_player_lines"], [unfreshBoxes, "unfresh_boxscores"]]) {
    if (ids.length) issue(code, "recent_boxscores");
  }
  const inconsistentFinals = [];
  for (const game of due.filter(game => game.boxscore_id && game.player_lines && isFinalStatus(game.boxscore_status))) {
    const reason = finalScoreIssue(parse(game.boxscore_home_team), parse(game.boxscore_away_team), game.player_point_totals);
    if (reason) inconsistentFinals.push({ game_id: game.game_id, reason });
  }
  if (inconsistentFinals.length) issue("inconsistent_final_boxscores", "recent_boxscores");
  const optional = [...states.entries()].filter(([name]) => name.startsWith("leaders:")).map(([name, row]) => ({
    stage: name, status: row.status, last_attempt_at: timestamp(row.last_attempt_at), last_success_at: timestamp(row.last_success_at),
  }));
  const empty = !inventory.games.length && !inventory.standings.length && !inventory.counts.player_stats && !teamIds.length && !verifiedNoPlay;
  const dates = inventory.games.map(game => game.date).filter(Boolean).sort();
  return { schema_version: 1, generated_at: now.toISOString(), season: SEASON, source: SOURCE, date, time_zone: "America/New_York",
    status: empty ? "empty" : issues.length ? "degraded" : "healthy", policy: { ...POLICY },
    coverage: { ...inventory.counts, games: inventory.games.length, played_games: seasonPlayed.length,
      game_date_from: dates[0] || null, game_date_to: dates.at(-1) || null,
      boxscores: inventory.games.filter(game => game.boxscore_id).length,
      season_missing_boxscore_ids: seasonPlayed.filter(game => !game.boxscore_id).map(game => game.game_id),
      player_lines: inventory.games.reduce((sum, game) => sum + game.player_lines, 0),
      standings: standingsIds.size, team_stats: teamIds.length,
      team_stats_missing_standings_ids: [...standingsIds].filter(id => !teamIds.includes(id)).sort((a, b) => a - b),
      recent: { from, to: date, games: recent.length, played_games: due.length,
        missing_boxscore_ids: missingBoxes, missing_player_line_ids: missingLines, unfresh_boxscore_ids: unfreshBoxes,
        inconsistent_final_boxscores: inconsistentFinals },
      verified_no_played_games: verifiedNoPlay },
    freshness: { games: observations(inventory.games.map(game => game.observed_at), POLICY.live_max_age_seconds),
      recent_games: recentObservations,
      boxscores: observations(inventory.games.filter(game => game.boxscore_id).map(game => game.boxscore_observed_at), POLICY.final_boxscore_max_age_seconds),
      team_stats: { observed_at: timestamp(inventory.snapshot?.observed_at) },
      standings: { observed_at: null, reason: "not_persisted" }, player_stats: { observed_at: null, reason: "not_persisted" } },
    stages, optional_stages: optional, issues };
}

function formatReport(report) {
  const c = report.coverage;
  const lines = [`Ingestion health: ${report.status.toUpperCase()} | ${report.season} | ${report.generated_at}`,
    `Coverage: ${c.teams} teams, ${c.active_players} active / ${c.players} total players; ${c.games} games (${c.played_games} played), ${c.boxscores} box scores, ${c.player_lines} player lines`,
    `Season views: ${c.standings}/30 standings, ${c.team_stats}/30 team stats, ${c.player_stats} player stats`,
    `Recent window: ${c.recent.from}..${c.recent.to} America/New_York; ${c.recent.played_games} played; missing boxes=${c.recent.missing_boxscore_ids.join(",") || "none"}; missing lines=${c.recent.missing_player_line_ids.join(",") || "none"}`,
    `Source observations (latest): games=${report.freshness.games.latest_observed_at || "unknown"}; boxes=${report.freshness.boxscores.latest_observed_at || "unknown"}; team stats=${report.freshness.team_stats.observed_at || "unknown"}`,
    `Recent game observations: ${report.freshness.recent_games.stale} stale, ${report.freshness.recent_games.missing} unknown, ${report.freshness.recent_games.future} future; unfresh boxes=${c.recent.unfresh_boxscore_ids.join(",") || "none"}`,
    `Final box-score point reconciliation: ${c.recent.inconsistent_final_boxscores.map(({ game_id, reason }) => `${game_id}=${reason}`).join(",") || "no discrepancies among checked boxes"}`,
    "Standings/player-stat source observation: unknown (not persisted). Static directories carry no live observation."];
  for (const stage of report.stages) lines.push(`  ${stage.stage}: ${stage.health} [${stage.status}] attempt=${stage.last_attempt_at || "never"} published=${stage.last_published_at || "none"} last_success=${stage.last_success_at || "never"}`);
  lines.push(`Optional leader stages: ${report.optional_stages.length} recorded, ${report.optional_stages.filter(row => row.status === "failed").length} failed (excluded from core health)`);
  if (report.issues.length) lines.push(`Issues: ${report.issues.map(row => `${row.scope}:${row.code}`).join("; ")}`);
  lines.push("Read-only DB evidence; six-hour operational grace, not a live SLA. Coverage is limited to known games; no upstream reachability probe.");
  return lines.join("\n");
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  if (flags.has("--help")) {
    console.log("Usage: node ingestion-health.js [--json]\nRequires DATABASE_URL; DATABASE_SCHEMA defaults to public. Read-only; no NBA/Redis calls.\nExit 0: healthy, 1: degraded/empty, 2: unavailable/configuration error.");
    return;
  }
  if ([...flags].some(flag => flag !== "--json") || !process.env.DATABASE_URL) throw new Error("Invalid configuration");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, query_timeout: 20000, max: 1 });
  try {
    const report = buildReport(await readInventory(pool, process.env.DATABASE_SCHEMA || "public"));
    console.log(flags.has("--json") ? JSON.stringify(report) : formatReport(report));
    process.exitCode = report.status === "healthy" ? 0 : 1;
  } finally { await pool.end(); }
}
if (require.main === module) main().catch(() => {
  // Driver errors may contain connection details. Keep automation output safe.
  const error = { schema_version: 1, status: "unavailable", error: "Health report unavailable: check database connection, schema and options." };
  console.log(process.argv.includes("--json") ? JSON.stringify(error) : error.error);
  process.exitCode = 2;
});
module.exports = { readInventory, buildReport, formatReport, POLICY };
