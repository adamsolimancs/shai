"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { buildReport, formatReport, readInventory, POLICY } = require("../ingestion-health");
const { SEASON } = require("../bootstrap-config");
const now = new Date("2026-10-26T16:00:00Z");
const observed = "2026-10-26T15:00:00Z";
const old = "2026-10-25T01:00:00Z";
function state(name, overrides = {}) {
  return { entity: `${SEASON}:${name}`, status: "ok", last_attempt_at: observed, last_success_at: observed,
    last_cursor: JSON.stringify({ completed_at: observed, rows: 1 }), ...overrides };
}
function healthy() {
  return { counts: { teams: 30, players: 5184, active_players: 530, player_stats: 400 },
    games: [{ game_id: "0022600001", date: "2026-10-25", observed_at: observed, home_team_score: 101, away_team_score: 99,
      boxscore_id: "0022600001", boxscore_status: "Final", boxscore_observed_at: observed, player_lines: 35,
      boxscore_home_team: JSON.stringify({ team_id: 1, score: 101 }),
      boxscore_away_team: JSON.stringify({ team_id: 2, score: 99 }),
      player_point_totals: [{ team_id: 1, points: 101 }, { team_id: 2, points: 99 }] }],
    standings: Array.from({ length: 30 }, (_, i) => ({ team_id: i + 1 })),
    snapshot: { observed_at: observed, payload: JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ team_id: i + 1 }))) },
    states: ["teams", "players", "games", "scoreboard:2026-10-26", "standings", "player_stats", "team_stats", "boxscore:0022600001"].map(name => state(name)) };
}
const report = inventory => buildReport(inventory, now);
const has = (result, code, scope) => result.issues.some(row => row.code === code && row.scope === scope);

test("healthy current-season coverage has stable version, real observations and separate publication evidence", () => {
  const result = report(healthy());
  assert.equal(result.status, "healthy");
  assert.equal(result.schema_version, 1);
  assert.equal(result.coverage.player_lines, 35);
  assert.equal(result.freshness.games.latest_observed_at, new Date(observed).toISOString());
  assert.equal(result.freshness.standings.observed_at, null);
  assert.equal(result.stages[0].source_observed_at, null);
  assert.equal(result.stages[0].freshness_basis, "checkpoint_publication");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.match(formatReport(result), /HEALTHY/);
  assert.match(formatReport(result), /source observation: unknown/);
});

test("static success and fresh checkpoints cannot freshen old or unknown source observations", () => {
  const inventory = healthy();
  inventory.games[0].observed_at = old;
  inventory.games[0].boxscore_observed_at = null;
  inventory.snapshot.observed_at = old;
  const result = report(inventory);
  assert.equal(result.status, "degraded");
  assert.equal(result.stages.every(row => row.health === "healthy"), true);
  assert(has(result, "unfresh_observations", "recent_games"));
  assert(has(result, "unfresh_observations", "team_stats"));
  assert.deepEqual(result.coverage.recent.unfresh_boxscore_ids, ["0022600001"]);
});

test("required failures and unfinished attempts retain last success without claiming publication", () => {
  const inventory = healthy();
  inventory.states = inventory.states.map(row => row.entity.endsWith(":games") ? state("games", {
    status: "failed", last_attempt_at: now.toISOString(), last_success_at: old,
    last_cursor: JSON.stringify({ completed_at: now.toISOString() }),
  }) : row);
  inventory.states.push(state("leaders:PTS", { status: "failed" }));
  const result = report(inventory);
  assert.equal(result.status, "degraded");
  assert(has(result, "stage_failed", "games"));
  const games = result.stages.find(row => row.stage === "games");
  assert.equal(games.last_success_at, new Date(old).toISOString());
  assert.equal(games.last_published_at, null);
  inventory.states.find(row => row.entity.endsWith(":games")).status = "running";
  assert(has(report(inventory), "stage_running", "games"));
});

test("optional leader failures do not change default core health", () => {
  const inventory = healthy();
  inventory.states.push(state("leaders:PTS", { status: "failed", last_success_at: old }));
  inventory.states.push(state("scoreboard:2026-10-24", { status: "failed" }));
  const result = report(inventory);
  assert.equal(result.status, "healthy");
  assert.equal(result.optional_stages[0].status, "failed");
  assert.equal(result.optional_stages[0].last_success_at, new Date(old).toISOString());
});

test("an initialized empty database is empty, with missing evidence and no invented coverage", () => {
  const result = report({ counts: { teams: 0, players: 0, active_players: 0, player_stats: 0 }, games: [], standings: [], snapshot: null, states: [] });
  assert.equal(result.status, "empty");
  assert.equal(result.coverage.verified_no_played_games, false);
  assert.equal(result.freshness.games.latest_observed_at, null);
  assert(has(result, "stage_missing", "games"));
  assert(has(result, "empty_coverage", "player_stats"));
});

test("a freshly published zero-game season is valid even with empty season-stat responses", () => {
  const inventory = healthy();
  inventory.games = [];
  inventory.standings = [];
  inventory.snapshot.payload = "[]";
  inventory.counts.player_stats = 0;
  for (const name of ["standings", "player_stats", "team_stats"]) {
    inventory.states = inventory.states.filter(row => row.entity !== `${SEASON}:${name}`);
    inventory.states.push(state(name, { status: "empty", last_success_at: null }));
  }
  const result = report(inventory);
  assert.equal(result.status, "healthy");
  assert.equal(result.coverage.verified_no_played_games, true);
  assert.equal(result.stages.find(row => row.stage === "player_stats").last_success_at, null);
  inventory.states.find(row => row.entity.endsWith(":games")).last_success_at = old;
  assert.equal(report(inventory).status, "empty", "zero rows without current inventory evidence are not a verified no-game state");
});

test("off-days have no missing box-score requirement; scheduled zero-score games are not played", () => {
  const inventory = healthy();
  inventory.games[0].date = "2026-10-24";
  inventory.games[0].observed_at = old;
  inventory.games[0].boxscore_id = null;
  inventory.games.push({ game_id: "0022600002", date: "2026-10-26", home_team_score: 0, away_team_score: 0,
    observed_at: observed, boxscore_id: null, player_lines: 0 });
  const result = report(inventory);
  assert.equal(result.status, "healthy");
  assert.equal(result.coverage.recent.played_games, 0);
  assert.deepEqual(result.coverage.season_missing_boxscore_ids, ["0022600001"]);
});

test("partial coverage reports distinct gaps, including boxes without player lines", () => {
  const inventory = healthy();
  inventory.games.push({ ...inventory.games[0], game_id: "0022600002", boxscore_id: null, player_lines: 0 });
  inventory.games[0].player_lines = 0;
  inventory.standings.pop();
  inventory.snapshot.payload = JSON.stringify([{ team_id: 1 }]);
  const result = report(inventory);
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.coverage.recent.missing_boxscore_ids, ["0022600002"]);
  assert.deepEqual(result.coverage.recent.missing_player_line_ids, ["0022600001"]);
  assert(has(result, "stage_missing", "boxscore:0022600002"));
  assert(has(result, "incomplete_coverage", "standings"));
  assert(has(result, "incomplete_coverage", "team_stats"));
});

test("checks both teams in final snapshots against their own scores even when another feed is newer", () => {
  const inventory = healthy();
  const game = inventory.games[0];
  game.home_team_score = 104;
  assert.equal(report(inventory).status, "healthy");

  game.player_point_totals = [{ team_id: 1, points: 98 }, { team_id: 2, points: 102 }];
  const result = report(inventory);
  assert.equal(result.status, "degraded", "a matching combined score can mask a missing scorer");
  assert.deepEqual(result.coverage.recent.inconsistent_final_boxscores, [
    { game_id: game.game_id, reason: "player_points_mismatch" },
  ]);
  assert.match(formatReport(result), /0022600001=player_points_mismatch/);

  game.boxscore_home_team = "invalid legacy JSON";
  assert.equal(report(inventory).coverage.recent.inconsistent_final_boxscores[0].reason, "invalid_final_scores");
  game.boxscore_status = "Q4";
  assert.equal(report(inventory).status, "healthy");
});

test("missing, corrupt and duplicate serving snapshots do not fabricate 30-team coverage", () => {
  for (const payload of ["bad JSON", "{}", "null", JSON.stringify(Array(30).fill({ team_id: 1 }))]) {
    const inventory = healthy(); inventory.snapshot.payload = payload;
    const result = report(inventory);
    assert.equal(result.status, "degraded");
    assert(result.coverage.team_stats <= 1);
  }
  const inventory = healthy(); inventory.snapshot = null;
  assert.equal(report(inventory).coverage.team_stats, 0);
});

test("fresh latest observations do not mask stale recent rows; future times are not fresh", () => {
  const inventory = healthy();
  inventory.games.push({ ...inventory.games[0], game_id: "0022600002", date: "2026-10-26", observed_at: old });
  inventory.states.push(state("boxscore:0022600002"));
  assert.equal(report(inventory).freshness.recent_games.stale, 1);
  inventory.games[0].observed_at = "2026-10-27T15:00:00Z";
  assert.equal(report(inventory).freshness.recent_games.future, 1);
  assert.equal(report(inventory).status, "degraded");
});

test("final box-score correction grace differs from non-final snapshots", () => {
  const inventory = healthy();
  const earlier = "2026-10-26T04:00:00Z";
  inventory.games[0].boxscore_observed_at = earlier;
  inventory.states.find(row => row.entity.includes(":boxscore:")).last_success_at = earlier;
  assert.equal(report(inventory).status, "healthy");
  inventory.games[0].boxscore_status = "Q3";
  assert.equal(report(inventory).status, "degraded");
  assert.equal(POLICY.live_max_age_seconds, 21600);
});

test("New York day and two-calendar-day window remain correct across DST", () => {
  const result = buildReport(healthy(), new Date("2026-11-02T04:30:00Z"));
  assert.equal(result.date, "2026-11-01");
  assert.equal(result.coverage.recent.from, "2026-10-31");
});

test("reader uses one read-only consistent snapshot and rolls back on query failure", async () => {
  const calls = [];
  const client = { query: async (sql, args) => { calls.push([sql, args]);
    if (sql.includes("AS active_players")) return { rows: [{ teams: 0, players: 0, active_players: 0, player_stats: 0 }] };
    return { rows: [] };
  }, release: () => calls.push(["release"]) };
  await readInventory({ connect: async () => client }, "health_test");
  assert.match(calls[0][0], /REPEATABLE READ READ ONLY/);
  assert(calls.some(([sql]) => sql.includes('"health_test".games')));
  assert.deepEqual(calls.slice(-2).map(([sql]) => sql), ["COMMIT", "release"]);
  await assert.rejects(readInventory({ connect: async () => { throw new Error("must not connect"); } }, 'bad"schema'), /Invalid database schema/);
  client.query = async sql => { calls.push([sql]); if (sql.startsWith("SELECT")) throw new Error("test failure"); };
  await assert.rejects(readInventory({ connect: async () => client }), /test failure/);
  assert.deepEqual(calls.slice(-2).map(([sql]) => sql), ["ROLLBACK", "release"]);
});

test("CLI reports unavailable/configuration separately without exposing deployment details", () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("DATABASE_") && !key.startsWith("PG")));
  for (const args of [["--json"], ["--json", "--oops"]]) {
    const result = spawnSync(process.execPath, [require.resolve("../ingestion-health"), ...args], { env, encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).status, "unavailable");
    assert.equal(result.stderr, "");
  }
});
