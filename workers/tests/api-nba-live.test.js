"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluate, normalizeApi, normalizeEspn, comparisons } = require("../check-api-nba-live");

const apiGame = (final = false, increment = 0) => ({ id: final ? 202 : 101, season: 2026, league: "standard",
  date: { start: final ? "2026-10-26T23:00:00Z" : "2026-10-27T02:00:00Z" },
  teams: { home: { id: 1, code: final ? "CHA" : "DEN" }, visitors: { id: 2, code: final ? "WAS" : "GSW" } },
  scores: { home: { points: final ? 110 : 32 + increment }, visitors: { points: final ? 103 : 26 } },
  status: { short: final ? 3 : 2, clock: final ? null : "1:20" }, periods: { current: final ? 4 : 1 } });
const espnGame = (final = false, increment = 0) => ({ id: final ? "999" : "888",
  status: { type: { state: final ? "post" : "in" }, period: final ? 4 : 1, displayClock: final ? "0.0" : "1:20" },
  competitions: [{ competitors: [
    { homeAway: "home", team: { abbreviation: final ? "CHA" : "DEN" }, score: String(final ? 110 : 32 + increment) },
    { homeAway: "away", team: { abbreviation: final ? "WSH" : "GS" }, score: String(final ? 103 : 26) },
  ] }] });

async function run({ blocked = false, http429 = false, key = "private-key", sampleCount = 4 } = {}) {
  let current = Date.parse("2026-10-27T02:34:33Z"), liveCalls = 0;
  const calls = [], logs = [];
  const report = await evaluate({ apiKey: key, sampleCount, now: () => current, sleep: async ms => { current += ms; },
    log: row => logs.push(row), fetchImpl: async (raw, options) => {
      const url = new URL(raw);
      calls.push({ url, options, at: current });
      if (url.hostname === "site.api.espn.com") {
        assert.equal(options.headers, undefined);
        return Response.json({ events: [espnGame(false, Math.max(0, liveCalls - 1) * 2), espnGame(true)] });
      }
      assert.equal(url.origin, "https://v2.nba.api-sports.io");
      assert.deepEqual(options.headers, { "x-apisports-key": key });
      if (http429) return Response.json({}, { status: 429 });
      let data;
      if (url.pathname === "/status") data = { account: { email: "private@example.test" }, subscription: { plan: "Free", active: true }, requests: { current: 0, limit_day: 100 } };
      else if (blocked) return Response.json({ errors: { plan: "Free plans cannot access 2026; private-key" }, response: [] });
      else if (url.searchParams.has("live")) data = [apiGame(false, liveCalls++ * 2)];
      else if (url.searchParams.has("date")) data = [apiGame(false, Math.max(0, liveCalls - 1) * 2), apiGame(true)];
      else if (url.pathname === "/games/statistics") data = [1, 2].map(id => ({ team: { id }, statistics: [{ points: id === 1 ? 110 : 103 }] }));
      else if (url.pathname === "/players/statistics") data = [1, 2].map(id => ({ team: { id }, points: id === 1 ? 110 : 103 }));
      else if (url.pathname === "/games" && url.searchParams.get("id") === "202") data = [apiGame(true)];
      else throw new Error("unexpected query");
      return Response.json({ errors: [], response: data }, { headers: { "x-ratelimit-requests-remaining": "90" } });
    } });
  return { report, calls, logs };
}

test("measures four live snapshots, comparisons and final totals with at most ten provider calls", async () => {
  const { report, calls, logs } = await run();
  assert.equal(report.status, "measured");
  assert.equal(report.provider_requests, 10);
  assert.equal(report.date, "2026-10-26");
  assert.equal(report.samples.length, 4);
  assert.equal(report.live_updates_observed, true);
  assert.deepEqual(report.comparisons, { total: 4, score_matches: 4, status_matches: 4 });
  assert.ok(report.boxscore.teams.every(row => row.game_points === row.team_stat_points && row.game_points === row.player_points_sum));
  const provider = calls.filter(row => row.url.hostname !== "site.api.espn.com");
  for (let i = 1; i < provider.length; i++) assert.ok(provider[i].at - provider[i - 1].at >= 6500);
  assert.ok(provider.some(row => row.url.searchParams.get("date") === "2026-10-27"));
  assert.ok(calls.every(row => row.options.method === "GET" && row.options.redirect === "error"));
  assert.ok(!JSON.stringify({ report, logs }).includes("private-key"));
  assert.ok(!JSON.stringify({ report, logs }).includes("private@example.test"));
});

test("tests live and both date filters before reporting a plan restriction without invented accuracy", async () => {
  const { report } = await run({ blocked: true });
  assert.equal(report.status, "unavailable");
  assert.equal(report.error, "no_accessible_current_day_game_data");
  assert.equal(report.provider_requests, 4);
  assert.equal(report.comparisons, undefined);
  assert.equal(report.live_updates_observed, false);
  assert.ok(report.checks.slice(1).every(row => row.error === "subscription_or_plan_restriction"));
  assert.ok(report.checks.slice(1).every(row => row.error_years_mentioned.includes("2026")));
  assert.ok(!JSON.stringify(report).includes("private-key"));
});

test("missing credentials cause no network calls", async () => {
  const { report, calls } = await run({ key: "" });
  assert.equal(report.error, "missing_api_sports_key");
  assert.equal(calls.length, 0);
});

test("a rate limit stops rather than retrying", async () => {
  const { report, calls } = await run({ http429: true });
  assert.equal(report.provider_requests, 1);
  assert.equal(calls.length, 1);
  assert.equal(report.quota_remaining, 0);
});

test("a single-snapshot spot check uses seven calls and cannot claim live changes", async () => {
  const { report } = await run({ sampleCount: 1 });
  assert.equal(report.provider_requests, 7);
  assert.equal(report.samples.length, 1);
  assert.equal(report.live_updates_observed, false);
});

test("unsupported sampling settings cannot expand the request budget", async () => {
  const { report, calls } = await run({ sampleCount: 100 });
  assert.equal(report.error, "invalid_sample_count");
  assert.equal(calls.length, 0);
});

test("normalizes provider aliases and rejects old-season or wrong-day rows", () => {
  const rows = [apiGame(), { ...apiGame(), season: 2025 }, { ...apiGame(), date: { start: "2026-10-25T23:00:00Z" } }];
  const data = normalizeApi(rows, "2026-10-26");
  assert.equal(data.length, 1);
  assert.equal(data[0].key, "GSW@DEN");
  assert.equal(normalizeEspn({ events: [espnGame()] })[0].key, "GSW@DEN");
});

test("allows a scoring transition within the reference window without calling it wrong", () => {
  const games = normalizeApi([apiGame(false, 2)], "2026-10-26");
  const before = { games: normalizeEspn({ events: [espnGame(false, 0)] }) };
  const after = { games: normalizeEspn({ events: [espnGame(false, 2)] }) };
  const [result] = comparisons(games, before, after);
  assert.equal(result.score_matches_reference_window, true);
  assert.equal(comparisons(games, before, before)[0].score_matches_reference_window, false);
  assert.equal(comparisons(games, null, null)[0].score_matches_reference_window, null);
});
