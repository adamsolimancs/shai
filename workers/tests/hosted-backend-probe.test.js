"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { probe } = require("../check-hosted-backend");

async function run({ healthStatus = 200, source = "api", hit = false, stale = false, observed = "2026-10-26T18:00:00Z", baseUrl = "https://backend.example.test" } = {}) {
  const calls = [], logs = [];
  const result = await probe({ baseUrl, apiKey: "private-key", now: () => Date.parse("2026-10-26T18:00:00Z"),
    log: row => logs.push(structuredClone(row)), fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.pathname === "/healthz") return Response.json({ status: "ok" }, { status: healthStatus });
      if (url.pathname === "/v1/meta") return Response.json({ ok: true, data: { service: "nba-data-api" } });
      assert.equal(url.pathname, "/v1/games");
      return Response.json({ ok: true, data: [{ game_id: "0022600001", team_id: 1610612737 }],
        meta: { source, stale, as_of: observed, cache: { hit, stale } } });
    } });
  return { result, calls, logs };
}

test("only accepts current-season rows from a new NBA observation", async () => {
  const { result, calls, logs } = await run();
  assert.equal(result.status, "passed");
  assert.equal(result.fresh_nba_verified, true);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].options.headers, {});
  assert.equal(calls[1].options.headers["x-api-key"], "private-key");
  assert.ok(calls.every(row => row.options.method === "GET" && row.options.redirect === "error"));
  assert.ok(!JSON.stringify({ result, logs }).includes("private-key"));
});

test("unavailable backend stops before authenticated requests", async () => {
  const { result, calls } = await run({ healthStatus: 404 });
  assert.equal(result.error, "http_404");
  assert.equal(calls.length, 1);
  assert.equal(result.fresh_nba_verified, false);
});

for (const options of [{ source: "db" }, { source: "redis" }, { hit: true }, { stale: true }, { observed: null }, { observed: "2026-10-25T18:00:00Z" }]) {
  test(`rejects insufficient freshness evidence ${JSON.stringify(options)}`, async () => {
    const { result } = await run(options);
    assert.equal(result.error, "fresh_upstream_fetch_not_proven");
    assert.equal(result.fresh_nba_verified, false);
  });
}

test("URL credentials, query parameters and insecure schemes fail before network access", async () => {
  for (const baseUrl of ["http://backend.example.test", "https://user:pass@backend.example.test", "https://backend.example.test/?key=private-key"]) {
    const { result, calls } = await run({ baseUrl });
    assert.equal(result.error, "unsafe_backend_url");
    assert.equal(calls.length, 0);
  }
});
