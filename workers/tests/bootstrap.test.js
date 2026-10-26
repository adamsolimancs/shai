const test = require("node:test");
const assert = require("node:assert/strict");
const { runBootstrap, checkSources } = require("../bootstrap");
const { normalizeV3Boxscore } = require("../bootstrap-source");
const { fixtureSource } = require("./fixtures/bootstrap-data.cjs");
const nba = require("../worker-live");

class MemoryStore {
  constructor() { this.states = new Map(); this.schema = "public"; this.pool = {}; this.published = []; }
  async state(entity) { return this.states.get(entity); }
  async record(_client, entity, status, cursor, error) { this.states.set(entity, { status, last_cursor: JSON.stringify(cursor), last_error: error }); }
  async commit(entity, cursor, publish, empty) {
    const queries = [];
    await publish({ query: async (sql, args) => queries.push({ sql, args }) });
    this.published.push(...queries);
    await this.record(null, entity, empty ? "empty" : "ok", cursor);
  }
  async recentGames() { return [{ game_id: "0022600001" }]; }
}
const options = (store, source) => ({ store, source, date: "2026-10-25", now: () => new Date("2026-10-25T12:00:00Z"), log: () => {} });

test("bootstrap seeds reference dependencies, only active identities, and only 2026-27", async () => {
  const store = new MemoryStore(); const source = fixtureSource();
  const result = await runBootstrap(options(store, source));
  assert.equal(result.ok, true);
  assert.deepEqual(source.calls.slice(0, 2).map(call => call.name), ["teams", "players"]);
  for (const call of source.calls.filter(call => ["games", "standings", "playerStats", "teamStats", "leaders"].includes(call.name))) assert.equal(call.args[0], "2026-27");
  const writes = store.published.filter(query => /INSERT INTO.*players/.test(query.sql));
  assert.equal(writes.some(query => query.args[0].includes("Historic Player")), false);
});

test("static mode performs no source network stages and resumes completed stages", async () => {
  const store = new MemoryStore(); const source = fixtureSource();
  assert.equal((await runBootstrap({ ...options(store, source), staticOnly: true })).ok, true);
  assert.deepEqual(source.calls.map(call => call.name), ["teams", "players"]);
  await runBootstrap({ ...options(store, source), staticOnly: true });
  assert.equal(source.calls.length, 2);
});

test("a failed boxscore retries while successful stages resume", async () => {
  const store = new MemoryStore(); const source = fixtureSource();
  let attempts = 0;
  const original = source.boxscore;
  source.boxscore = async id => { if (++attempts === 1) throw new Error("source timeout"); return original(id); };
  assert.equal((await runBootstrap(options(store, source))).ok, false);
  assert.equal((await runBootstrap(options(store, source))).ok, true);
  assert.equal(source.calls.filter(call => call.name === "playerStats").length, 1);
  assert.equal(attempts, 2);
});

test("failed/invalid references stop dependent source calls", async () => {
  const store = new MemoryStore(); const source = fixtureSource();
  source.teams = async () => [];
  assert.equal((await runBootstrap(options(store, source))).ok, false);
  assert.equal(source.calls.length, 0);
});

test("empty season stats are not marked complete or used to erase stored data", async () => {
  const store = new MemoryStore(); const source = fixtureSource();
  source.playerStats = async () => [];
  assert.equal((await runBootstrap(options(store, source))).ok, false);
  assert.equal((await store.state("2026-27:player_stats")).status, "empty");
});

test("unrequested enrichment is excluded; explicitly requested leaderboard failures remain failures", async () => {
  const source = fixtureSource(); const store = new MemoryStore();
  source.leaders = async () => { throw new Error("upstream leaderboard unavailable"); };
  assert.equal((await runBootstrap(options(store, source))).ok, true);
  assert.equal((await runBootstrap({ ...options(store, source), includeLeaders: true })).ok, false);
  assert.equal((await store.state("2026-27:leaders:PTS")).status, "failed");
});

test("rejects historical seasons and cross-season upstream data", async () => {
  const store = new MemoryStore(); const source = fixtureSource();
  await assert.rejects(runBootstrap({ ...options(store, source), season: "2025-26" }), /historical imports are disabled/);
  source.games = async () => [{ ...source.game, game_id: "0022500001" }];
  assert.equal((await runBootstrap(options(store, source))).ok, false);
  assert.equal((await store.state("2026-27:games")).status, "failed");
});

test("season game refreshes preserve optional tipoff times and reject incomplete teams", async () => {
  const source = fixtureSource(); const store = new MemoryStore();
  source.game.start_time = null;
  assert.equal((await runBootstrap(options(store, source))).ok, true);
  const insert = store.published.find(query => /INSERT INTO.*games/.test(query.sql));
  assert.equal("start_time" in JSON.parse(insert.args[0])[0], false);
  source.game.home_team_id = null;
  assert.equal((await runBootstrap({ ...options(store, source), refresh: true })).ok, false);
  assert.equal((await store.state("2026-27:games")).status, "failed");
});

test("source checks require actual season and boxscore access", async () => {
  assert.equal((await checkSources(fixtureSource())).ok, true);
  const source = fixtureSource(); source.boxscore = async () => { throw new Error("blocked"); };
  assert.equal((await checkSources(source)).ok, false);
});

test("league leader requests include nba_api's required Scope parameter", async () => {
  const config = { transport: nba.CONFIG.statsTransport, interval: nba.CONFIG.apiMinIntervalMs };
  const original = global.fetch;
  try {
    nba.CONFIG.statsTransport = "fetch";
    nba.CONFIG.apiMinIntervalMs = 0;
    let requested;
    global.fetch = async url => {
      requested = new URL(url);
      return new Response(JSON.stringify({ resultSets: [{ name: "LeagueLeaders", headers: ["PLAYER_ID", "PTS"], rowSet: [[102, 30]] }] }));
    };
    const rows = await nba.fetchLeagueLeadersRows("2026-27");
    assert.equal(rows.length, 1);
    assert.equal(requested.searchParams.get("Scope"), "S");
    assert.equal(requested.searchParams.get("ActiveFlag"), "");
  } finally {
    nba.CONFIG.statsTransport = config.transport;
    nba.CONFIG.apiMinIntervalMs = config.interval;
    global.fetch = original;
  }
});

test("V3 boxscore validates identity and normalizes player names, totals and times", () => {
  const team = id => ({ teamId: id, teamName: `Team ${id}`, teamTricode: `T${id}`, statistics: { points: 100 }, players: [{ personId: 100 + id, firstName: "Test", familyName: "Player", statistics: { points: 100, minutes: "30:00" } }] });
  const stats = { boxScoreTraditional: { gameId: "0022600001", homeTeam: team(1), awayTeam: team(2) } };
  const summary = { boxScoreSummary: { gameId: "0022600001", gameStatus: 3, gameStatusText: "Final", gameEt: "2026-10-24T20:00:00Z", gameTimeUTC: "2026-10-25T00:00:00Z", homeTeam: { ...team(1), score: 100 }, awayTeam: { ...team(2), score: 100 } } };
  const box = normalizeV3Boxscore(stats, summary, "0022600001", "2026-10-25T01:00:00Z");
  assert.equal(box.traditional_players[0].player_name, "Test Player");
  assert.equal(box.game_date, "2026-10-24");
  assert.equal(box.team_totals[0].points, 100);
  assert.throws(() => normalizeV3Boxscore(stats, summary, "0022600002", "now"), /mismatched/);
});
