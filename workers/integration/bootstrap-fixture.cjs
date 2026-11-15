"use strict";
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { runBootstrap, BootstrapStore } = require("../bootstrap");
const { fixtureSource } = require("../tests/fixtures/bootstrap-data.cjs");
const { readInventory, buildReport } = require("../ingestion-health");
const { spawnSync } = require("node:child_process");
const pool = new Pool({ host: process.argv[2], user: "postgres", database: "postgres" });
const source = fixtureSource();
const original = source.boxscore;
let attempts = 0;
source.boxscore = async id => {
  attempts++;
  if (attempts === 1) throw new Error("simulated upstream outage");
  const result = await original(id);
  if (attempts === 2) {
    result.home_team.score = 250;
    result.traditional_players[0].points = 179;
    result.advanced_players.push({ player_id: 999, team_id: 1 });
  }
  return result;
};
const options = { store: new BootstrapStore(pool), source, date: "2026-10-25", now: () => new Date("2026-10-25T12:00:00Z"), log: () => {} };
const scalar = async sql => (await pool.query(sql)).rows[0].value;
(async () => {
  assert.equal(await scalar("SELECT count(*)::int AS value FROM teams"), 0);
  assert.equal(buildReport(await readInventory(pool), options.now()).status, "empty");
  const healthCli = () => spawnSync(process.execPath, [require.resolve("../ingestion-health"), "--json"], {
    env: { ...process.env, DATABASE_URL: `postgresql://postgres@localhost/postgres?host=${encodeURIComponent(process.argv[2])}`, DATABASE_SCHEMA: "public" }, encoding: "utf8",
  });
  let cli = healthCli();
  assert.equal(cli.status, 1);
  assert.equal(JSON.parse(cli.stdout).status, "empty");
  assert.equal((await runBootstrap(options)).ok, false);
  assert.equal(await scalar("SELECT count(*)::int AS value FROM teams"), 30);
  assert.equal(await scalar("SELECT count(*)::int AS value FROM boxscores"), 0);
  assert.equal((await runBootstrap(options)).ok, false, "FK failure must abort publication/checkpoint");
  assert.equal(await scalar("SELECT home_team_score::int AS value FROM games WHERE game_id='0022600001'"), 101);
  assert.equal(await scalar("SELECT count(*)::int AS value FROM boxscores"), 0);
  assert.equal((await runBootstrap(options)).ok, true);
  assert.equal(source.calls.filter(call => call.name === "playerStats").length, 1);
  assert.equal(await scalar("SELECT count(*)::int AS value FROM players WHERE player_id='101'"), 0, "inactive historical players must not be imported");
  assert.equal(await scalar("SELECT count(*)::int AS value FROM players WHERE player_id='102'"), 1, "new current-season players satisfy foreign keys");
  assert.equal(await scalar(`SELECT jsonb_path_query_first(public.get_boxscore_snapshot('0022600001'), '$.players[*] ? (@.player_id == "102").points') AS value`), 30);
  const calls = source.calls.length;
  assert.equal((await runBootstrap(options)).ok, true);
  assert.equal(source.calls.length, calls, "restart skips committed work within freshness windows");
  assert.equal((await runBootstrap({ ...options, refresh: true, includeLeaders: true })).ok, true);
  assert.equal(await scalar("SELECT count(*)::int AS value FROM league_leader_rows"), 5);
  assert.equal(await scalar("SELECT count(*)::int AS value FROM games WHERE season <> 2026"), 0);
  source.boxscore = async id => {
    const box = await original(id);
    box.observed_at = "2026-10-25T11:00:00.000Z";
    box.traditional_players[0].points = 27;
    return box;
  };
  const rejected = await runBootstrap({ ...options, refresh: true });
  assert.equal(rejected.ok, false);
  assert.match(rejected.results.at(-1).error, /player_points_mismatch/);
  assert.equal(await scalar("SELECT points AS value FROM boxscore_players WHERE game_id='0022600001' AND player_id='102'"), 30);
  assert.equal(await scalar("SELECT observed_at = TIMESTAMPTZ '2026-10-25T01:00:00Z' AS value FROM boxscores WHERE game_id='0022600001'"), true);
  source.boxscore = original;
  assert.equal((await runBootstrap(options)).ok, true);
  console.log("Empty-database bootstrap passed: dependency order, atomic rollback, retries, resume, idempotence, current-season isolation.");

  await pool.query("INSERT INTO games(game_id,season,date,home_team_score,away_team_score) VALUES ('0022500001',2025,'2025-10-25',100,99)");
  await pool.query("INSERT INTO player_season_stats(season,player_id) VALUES ('2025-26','102')");
  await pool.query("INSERT INTO league_standings(season,team_id) VALUES ('2025-26',1)");
  await pool.query("INSERT INTO ingestion_state(source,entity,status) VALUES ('bootstrap:v1','2025-26:games','failed'),('nba_api','2026-27:games','failed')");
  const beforeHealth = await scalar("SELECT jsonb_agg(to_jsonb(s) ORDER BY entity)::text AS value FROM ingestion_state s");
  const partial = buildReport(await readInventory(pool), options.now());
  assert.equal(partial.status, "degraded");
  assert.equal(partial.coverage.teams, 30);
  assert.equal(partial.coverage.players, 3);
  assert.equal(partial.coverage.active_players, 3);
  assert.equal(partial.coverage.games, 1);
  assert.equal(partial.coverage.boxscores, 1);
  assert.equal(partial.coverage.player_lines, 3);
  assert.equal(partial.coverage.player_stats, 1);
  assert.equal(partial.coverage.standings, 1);
  assert.equal(partial.coverage.team_stats, 1);
  assert.equal(partial.freshness.games.latest_observed_at, "2026-10-25T01:00:00.000Z");
  assert.equal(await scalar("SELECT jsonb_agg(to_jsonb(s) ORDER BY entity)::text AS value FROM ingestion_state s"), beforeHealth, "health reads must not alter checkpoints");

  // Complete only disposable fixture data, then exercise the real CLI exit codes.
  const at = new Date().toISOString();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
  await pool.query("INSERT INTO league_standings(season,team_id) SELECT '2026-27',team_id FROM teams ON CONFLICT DO NOTHING");
  await pool.query("UPDATE games SET date=$1,observed_at=$2 WHERE season=2026", [date, at]);
  await pool.query("UPDATE boxscores SET observed_at=$1", [at]);
  await pool.query("UPDATE api_snapshots SET payload=$1,observed_at=$2", [JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ team_id: i + 1 }))), at]);
  await pool.query("UPDATE ingestion_state SET last_attempt_at=$1,last_success_at=$1 WHERE source='bootstrap:v1'", [at]);
  await pool.query("INSERT INTO ingestion_state(source,entity,status,last_attempt_at,last_success_at) VALUES ('bootstrap:v1',$1,'ok',$2,$2) ON CONFLICT(source,entity) DO UPDATE SET status='ok',last_success_at=$2,last_attempt_at=$2", [`2026-27:scoreboard:${date}`, at]);
  cli = healthCli();
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  assert.equal(JSON.parse(cli.stdout).status, "healthy");
  await pool.query("DELETE FROM boxscore_players WHERE game_id='0022600001' AND player_id='102'");
  cli = healthCli();
  assert.equal(cli.status, 1);
  const incomplete = JSON.parse(cli.stdout);
  assert.equal(incomplete.status, "degraded");
  assert.equal(incomplete.coverage.player_lines, 2);
  assert.deepEqual(incomplete.coverage.recent.inconsistent_final_boxscores, [
    { game_id: "0022600001", reason: "player_points_mismatch" },
  ]);
  await pool.query("UPDATE ingestion_state SET status='failed' WHERE entity='2026-27:games'");
  cli = healthCli();
  assert.equal(cli.status, 1);
  const failed = JSON.parse(cli.stdout);
  assert.equal(failed.status, "degraded");
  assert.equal(failed.stages.find(row => row.stage === "games").last_success_at, at);
  console.log("Ingestion health passed: empty/partial/healthy/failed SQL inventory, final score reconciliation, retained observations, read-only checkpoints, real CLI exits.");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
