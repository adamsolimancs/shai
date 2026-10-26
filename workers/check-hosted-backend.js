#!/usr/bin/env node
"use strict";

// GET-only qualification of the configured backend. Deployment secrets stay in Actions.
const { appendFileSync } = require("node:fs");
const { readJson } = require("./check-api-nba");

async function probe({ baseUrl, apiKey, fetchImpl = fetch, now = () => Date.now(), log = () => {} } = {}) {
  const report = { status: "failed", season: "2026-27", fresh_nba_verified: false, checks: [] };
  const fail = code => { throw new Error(code); };
  try {
    if (!baseUrl || !apiKey?.trim()) fail("missing_backend_configuration");
    let base;
    try { base = new URL(baseUrl.trim()); } catch { fail("invalid_backend_url"); }
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) fail("unsafe_backend_url");
    report.backend_host = base.host;
    log({ backend_host: base.host, protocol: base.protocol });
    async function get(name, path, authenticated = false, timeout = 20000) {
      const row = { name, path, status: "failed" };
      report.checks.push(row);
      const start = now();
      try {
        const response = await fetchImpl(new URL(path, base.origin), {
          method: "GET", redirect: "error", signal: AbortSignal.timeout(timeout),
          headers: authenticated ? { "x-api-key": apiKey.trim() } : {},
        });
        row.http_status = response.status;
        if (!response.ok) {
          // Retain only known service error codes; never echo arbitrary response text.
          try {
            const errorBody = await readJson(response);
            const code = errorBody?.error?.code ?? errorBody?.detail?.code;
            if (["UPSTREAM_ERROR", "UNAUTHORIZED", "CONFIG_ERROR", "DB_UNAVAILABLE", "RATE_LIMITED"].includes(code)) row.backend_error_code = code;
          } catch { /* HTTP failure is still conclusive without a JSON error body. */ }
          fail(`http_${response.status}`);
        }
        const body = await readJson(response);
        row.status = "passed";
        return body;
      } catch (error) {
        const safe = /^(http_\d{3}|invalid_json|response_too_large|missing_response_body|request_timeout)$/.test(error.message);
        row.error = safe ? error.message : "backend_network_error";
        fail(row.error);
      } finally {
        row.duration_ms = now() - start;
        log(row);
      }
    }
    const health = await get("health", "/healthz", false, 90000);
    if (health?.status !== "ok") fail("unexpected_health_response");
    const meta = await get("authenticated_service", "/v1/meta", true);
    if (meta?.ok !== true || meta.data?.service !== "nba-data-api") fail("unexpected_backend_service");
    const started = now();
    // per_team bypasses the database-backed /games branch in this repository.
    // Query the whole season to avoid filling the service's season cache with a date subset.
    const result = await get("nba_game_fetch", "/v1/games?season=2026-27&per_team=true&page_size=200", true, 90000);
    let observation = Date.parse(result?.meta?.as_of ?? result?.meta?.cache?.as_of);
    report.source = ["api", "db", "redis", "service"].includes(result?.meta?.source) ? result.meta.source : "unknown";
    report.cache_hit = result?.meta?.cache?.hit ?? null;
    report.stale = result?.meta?.stale ?? result?.meta?.cache?.stale ?? null;
    report.rows = Array.isArray(result?.data) ? result.data.length : 0;
    if (result?.ok !== true || !report.rows) fail("no_current_season_game_rows");
    // The deployed legacy backend exposes successful upstream observations through
    // /meta rather than per-response as_of. Require a newly advanced timestamp;
    // neither a warm cache nor a DB response can satisfy this fallback.
    if (report.cache_hit === false && report.stale === false
      && [undefined, "api"].includes(result?.meta?.source) && !Number.isFinite(observation)) {
      const after = await get("upstream_refresh_confirmation", "/v1/meta", true);
      const refreshes = Object.entries(after?.data?.last_cache_refresh ?? {})
        .filter(([key]) => key === "games:2026-27" || key.startsWith("games:2026-27:"))
        .filter(([key, value]) => Date.parse(value) > (Date.parse(meta?.data?.last_cache_refresh?.[key]) || 0))
        .map(([, value]) => Date.parse(value)).filter(Number.isFinite);
      if (refreshes.length) {
        observation = Math.max(...refreshes);
        report.source = "api";
        report.evidence = "advanced_service_upstream_refresh";
      }
    }
    if (report.source !== "api" || report.cache_hit !== false || report.stale !== false
      || !Number.isFinite(observation) || observation < started - 1000 || observation > now() + 1000) fail("fresh_upstream_fetch_not_proven");
    if (!result.data.every(row => /^00226\d{5}$/.test(String(row.game_id)) && Number.isInteger(row.team_id))) fail("unexpected_game_scope");
    report.fresh_nba_verified = true;
    report.evidence ??= "response_source_observation";
    report.status = "passed";
  } catch (error) {
    const safe = /^(missing_backend_configuration|invalid_backend_url|unsafe_backend_url|http_\d{3}|unexpected_health_response|unexpected_backend_service|no_current_season_game_rows|fresh_upstream_fetch_not_proven|unexpected_game_scope|backend_network_error|invalid_json|response_too_large|missing_response_body|request_timeout)$/.test(error.message);
    report.error = safe ? error.message : "backend_probe_failed";
  }
  return report;
}

async function main() {
  const result = await probe({ baseUrl: process.env.BACKEND_API_BASE_URL, apiKey: process.env.BACKEND_API_KEY,
    log: row => console.log(JSON.stringify(row)) });
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Hosted backend source probe\n\nResult: ${result.status}. Fresh NBA fetch verified: ${result.fresh_nba_verified}.\n\n` +
    result.checks.map(row => `- ${row.name}: HTTP ${row.http_status ?? "unavailable"}${row.error ? ` (${row.error})` : ""}`).join("\n") +
    `\n\n${result.error ? `Failure: ${result.error}.` : ""}\n`);
  process.exitCode = result.status === "passed" ? 0 : 1;
}
if (require.main === module) main().catch(() => { console.error("Hosted backend probe could not finish"); process.exitCode = 1; });
module.exports = { probe };
