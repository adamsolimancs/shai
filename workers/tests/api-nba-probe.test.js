"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { qualify, readJson, markdown, BASE, INTERVAL_MS, MAX_REQUESTS } = require("../check-api-nba");

function fixture() {
  const game = { id: 42, season: 2026, league: "standard", date: { start: "2026-10-25T23:00:00Z" },
    status: { short: 3 }, teams: { home: { id: 1 }, visitors: { id: 2 } },
    scores: { home: { points: 100 }, visitors: { points: 90 } } };
  return {
    "/status": { subscription: { plan: "Free", active: true }, requests: { current: 1, limit_day: 100 }, account: { email: "private@example.test" } },
    "/seasons": [2025, 2026],
    "/leagues": ["standard"],
    "/games?league=standard&season=2026": [game],
    "/teams?league=standard": Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}` })),
    "/standings?league=standard&season=2026": Array.from({ length: 30 }, (_, i) => ({ season: 2026, league: "standard", team: { id: i + 1 } })),
    "/players?team=1&season=2026": [{ id: 1, firstname: "Test", lastname: "Player" }],
    "/teams/statistics?id=1&season=2026": [{ games: 2, points: 200 }],
    "/games/statistics?id=42": [1, 2].map(team => ({ team: { id: team }, statistics: [{ points: team === 1 ? 100 : 90 }] })),
    "/players/statistics?game=42": [1, 2].flatMap(team => Array.from({ length: 5 }, (_, i) => ({
      player: { id: team * 100 + i }, team: { id: team }, game: { id: 42 }, points: team === 1 ? 20 : 18,
    }))),
  };
}

async function run({ data = fixture(), override = () => null, apiKey = " test-secret " } = {}) {
  let clock = 0;
  const calls = [], logs = [];
  const report = await qualify({ apiKey, date: new Date("2026-10-26T16:00:00Z"),
    now: () => clock, sleep: async ms => { clock += ms; }, log: row => logs.push(structuredClone(row)),
    fetchImpl: async (url, options) => {
      const path = url.pathname + url.search;
      calls.push({ url, options, at: clock });
      const custom = override(path, calls.length);
      if (custom) return custom;
      assert.ok(Object.hasOwn(data, path), `unexpected query: ${path}`);
      return Response.json({ errors: [], response: data[path] }, {
        headers: { "x-ratelimit-requests-remaining": String(100 - calls.length) },
      });
    },
  });
  return { report, calls, logs };
}

test("qualifies current-season coverage with ten paced, read-only provider calls", async () => {
  const { report, calls, logs } = await run();
  assert.equal(report.status, "passed");
  assert.equal(report.request_count, MAX_REQUESTS);
  assert.equal(report.free_plan_verified, true);
  assert.equal(report.live_updates_verified, false);
  assert.equal(report.sample_game.provider_game_id, 42);
  assert.equal(report.checks.length, 10);
  assert.ok(report.checks.every(row => row.status === "passed"));
  for (const [i, call] of calls.entries()) {
    assert.equal(call.url.origin, BASE);
    assert.equal(call.options.method, "GET");
    assert.equal(call.options.redirect, "error");
    assert.deepEqual(call.options.headers, { "x-apisports-key": "test-secret" });
    if (i) assert.ok(call.at - calls[i - 1].at >= INTERVAL_MS);
  }
  const output = JSON.stringify({ report, logs }) + markdown(report);
  assert.ok(!output.includes("test-secret"));
  assert.ok(!output.includes("private@example.test"));
  assert.ok(!calls.some(call => /2025/.test(call.url.search)));
});

test("missing key stops before any requests", async () => {
  const { report, calls } = await run({ apiKey: "" });
  assert.equal(report.error, "missing_api_sports_key");
  assert.equal(calls.length, 0);
});

for (const [name, mutate, error] of [
  ["paid subscription", data => { data["/status"].subscription.plan = "Pro"; }, "not_a_free_subscription"],
  ["inactive subscription", data => { data["/status"].subscription.active = false; }, "subscription_inactive"],
  ["old season only", data => { data["/seasons"] = [2025]; }, "season_2026_unavailable"],
  ["empty games", data => { data["/games?league=standard&season=2026"] = []; }, "season_games_empty"],
  ["wrong game season", data => { data["/games?league=standard&season=2026"][0].season = 2025; }, "game_identity_or_season_mismatch"],
  ["unfinished game", data => { data["/games?league=standard&season=2026"][0].status.short = 2; }, "no_completed_regular_season_sample"],
  ["incomplete standings", data => { data["/standings?league=standard&season=2026"].pop(); }, "standings_not_30_distinct_teams"],
  ["empty season totals", data => { data["/teams/statistics?id=1&season=2026"] = []; }, "season_team_statistics_empty_or_invalid"],
  ["wrong team total", data => { data["/games/statistics?id=42"][0].statistics[0].points = 99; }, "team_boxscore_score_mismatch"],
  ["wrong player total", data => { data["/players/statistics?game=42"][0].points = 19; }, "player_points_do_not_reconcile"],
  ["duplicate player", data => { const rows = data["/players/statistics?game=42"]; rows[1].player.id = rows[0].player.id; }, "duplicate_player_boxscore_line"],
]) {
  test(`rejects ${name} without retries or historical fallback`, async () => {
    const data = fixture();
    mutate(data);
    const { report, calls } = await run({ data });
    assert.equal(report.status, "failed");
    assert.equal(report.error, error);
    assert.ok(calls.length <= MAX_REQUESTS);
  });
}

test("HTTP 200 provider errors fail without exposing arbitrary response text", async () => {
  const { report, calls, logs } = await run({ override: path => path === "/games?league=standard&season=2026"
    ? Response.json({ errors: { plan: "Free subscription cannot access 2026 test-secret" }, response: [] }) : null });
  assert.equal(report.error, "subscription_or_plan_restriction");
  assert.equal(calls.length, 4);
  assert.equal(report.checks.at(-1).status, "failed");
  assert.ok(!JSON.stringify({ report, logs }).includes("test-secret"));
});

test("insufficient quota stops after status and makes no retry", async () => {
  const { report, calls } = await run({ override: () => Response.json({ errors: [], response: fixture()["/status"] },
    { headers: { "x-ratelimit-requests-remaining": "8" } }) });
  assert.equal(report.error, "insufficient_daily_quota_for_test");
  assert.equal(calls.length, 1);
});

test("HTTP rate limiting stops without reading or echoing its error body", async () => {
  const { report, calls } = await run({ override: () => new Response("test-secret", { status: 429 }) });
  assert.equal(report.error, "rate_limited");
  assert.equal(calls.length, 1);
  assert.ok(!JSON.stringify(report).includes("test-secret"));
});

test("malformed JSON is a safe failure", async () => {
  const { report } = await run({ override: () => new Response("<html>test-secret</html>") });
  assert.equal(report.error, "invalid_json");
});

test("rejects oversized and missing response bodies", async () => {
  await assert.rejects(readJson(new Response("x".repeat(8 * 1024 * 1024 + 1))), /response_too_large/);
  await assert.rejects(readJson(new Response(null)), /missing_response_body/);
});

test("body timeout is distinguishable from invalid JSON", async () => {
  const body = new ReadableStream({ start(controller) {
    controller.error(new DOMException("private detail", "TimeoutError"));
  } });
  await assert.rejects(readJson(new Response(body)), /request_timeout/);
});
