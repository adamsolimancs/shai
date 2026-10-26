"use strict";
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { runBootstrap, BootstrapStore } = require("../bootstrap");
const { fixtureSource } = require("../tests/fixtures/bootstrap-data.cjs");
const pool = new Pool({ host: process.argv[2], user: "postgres", database: "postgres" });
const source = fixtureSource();
const original = source.boxscore;
let attempts = 0;
source.boxscore = async id => {
  attempts++;
  if (attempts === 1) throw new Error("simulated upstream outage");
  const result = await original(id);
  if (attempts === 2) { result.traditional_players[0].team_id = 999; result.home_team.score = 250; }
  return result;
};
const options = { store: new BootstrapStore(pool), source, date: "2026-10-25", now: () => new Date("2026-10-25T12:00:00Z"), log: () => {} };
const scalar = async sql => (await pool.query(sql)).rows[0].value;
(async () => {
  assert.equal(await scalar("SELECT count(*)::int AS value FROM teams"), 0);
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
  assert.equal(await scalar("SELECT public.get_boxscore_snapshot('0022600001')->'players'->0->>'points' AS value"), "30");
  const calls = source.calls.length;
  assert.equal((await runBootstrap(options)).ok, true);
  assert.equal(source.calls.length, calls, "restart skips committed work within freshness windows");
  assert.equal((await runBootstrap({ ...options, refresh: true, includeLeaders: true })).ok, true);
  assert.equal(await scalar("SELECT count(*)::int AS value FROM league_leader_rows"), 5);
  assert.equal(await scalar("SELECT count(*)::int AS value FROM games WHERE season <> 2026"), 0);
  console.log("Empty-database bootstrap passed: dependency order, atomic rollback, retries, resume, idempotence, current-season isolation.");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
