#!/usr/bin/env node
"use strict";

// Read-only provider qualification. No database/cache modules or deployment credentials.
const { appendFileSync } = require("node:fs");
const BASE = "https://v2.nba.api-sports.io";
const SEASON = 2026;
const MAX_REQUESTS = 10;
const INTERVAL_MS = 6500; // Free plan: no more than ten requests per minute.

class ProbeError extends Error {
  constructor(code, status = null) { super(code); this.code = code; this.status = status; }
}
const requireThat = (condition, code) => { if (!condition) throw new ProbeError(code); };
const id = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const numeric = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const remainingQuota = headers => {
  const value = headers.get("x-ratelimit-requests-remaining");
  return value !== null && /^\d+$/.test(value) ? Number(value) : null;
};

async function readJson(response) {
  const reader = response.body?.getReader();
  requireThat(reader, "missing_response_body");
  let length = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      requireThat(length <= 8 * 1024 * 1024, "response_too_large");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof ProbeError) throw error;
    if (error?.name === "TimeoutError" || error?.name === "AbortError") throw new ProbeError("request_timeout");
    throw new ProbeError("invalid_json");
  } finally { await reader.cancel().catch(() => {}); }
}

function providerError(errors) {
  // Classify errors without printing arbitrary provider text that might echo a key.
  const text = JSON.stringify(errors).toLowerCase();
  if (/free|subscription|plan|access/.test(text)) return "subscription_or_plan_restriction";
  if (/token|api.key|credential/.test(text)) return "credentials_rejected";
  if (/quota|limit|request/.test(text)) return "provider_quota_or_parameter_error";
  return "provider_rejected_query";
}

async function qualify({ apiKey, fetchImpl = fetch, sleep = pause, now = () => Date.now(),
  date = new Date(), log = () => {} } = {}) {
  const report = { provider: "API-NBA by API-SPORTS", season: "2026-27", provider_season: SEASON,
    status: "failed", request_count: 0, quota_remaining: null, free_plan_verified: false,
    checked_at: date.toISOString(), checks: [], live_updates_verified: false,
    limits: ["One completed-game sample; continuous live clock/score updates are not verified."],
  };
  let lastStart = null;
  async function check(name, endpoint, validate, { array = true } = {}) {
    const row = { name, endpoint, status: "failed", http_status: null };
    report.checks.push(row);
    try {
      requireThat(report.request_count < MAX_REQUESTS, "request_budget_exhausted");
      requireThat(report.quota_remaining === null || report.quota_remaining > 0, "daily_quota_exhausted");
      const url = new URL(endpoint, BASE);
      requireThat(url.origin === BASE, "unexpected_provider_host");
      if (lastStart !== null) await sleep(Math.max(0, INTERVAL_MS - (now() - lastStart)));
      lastStart = now();
      report.request_count++;
      const signal = AbortSignal.timeout(15000);
      let response;
      try {
        response = await fetchImpl(url, { method: "GET", redirect: "error", signal,
          headers: { "x-apisports-key": apiKey } });
      } catch { throw new ProbeError(signal.aborted ? "request_timeout" : "network_request_failed"); }
      row.http_status = response.status;
      report.quota_remaining = remainingQuota(response.headers);
      requireThat(response.ok, response.status === 429 ? "rate_limited" : `http_${response.status}`);
      const payload = await readJson(response);
      requireThat(payload && typeof payload === "object" && "errors" in payload && "response" in payload, "invalid_response_envelope");
      if (payload.errors && Object.keys(payload.errors).length) throw new ProbeError(providerError(payload.errors));
      if (array) requireThat(Array.isArray(payload.response), "expected_response_array");
      row.rows = Array.isArray(payload.response) ? payload.response.length : 1;
      const result = validate(payload.response);
      row.status = "passed";
      row.duration_ms = now() - lastStart;
      row.quota_remaining = report.quota_remaining;
      log(row);
      return result ?? payload.response;
    } catch (error) {
      row.error = error instanceof ProbeError ? error.code : "validation_failed";
      log(row);
      throw error;
    }
  }
  try {
    requireThat(typeof apiKey === "string" && apiKey.trim().length > 0, "missing_api_sports_key");
    apiKey = apiKey.trim();
    await check("free_subscription", "/status", data => {
      requireThat(data && /\bfree\b/i.test(String(data.subscription?.plan)), "not_a_free_subscription");
      requireThat(data.subscription.active !== false, "subscription_inactive");
      report.free_plan_verified = true;
      const available = report.quota_remaining ?? (Number(data.requests?.limit_day) - Number(data.requests?.current));
      requireThat(Number.isFinite(available) && available >= MAX_REQUESTS - 1, "insufficient_daily_quota_for_test");
    }, { array: false });
    await check("season_available", "/seasons", rows => {
      requireThat(rows.some(value => Number(value) === SEASON), "season_2026_unavailable");
    });
    await check("standard_league", "/leagues", rows => {
      requireThat(rows.includes("standard"), "standard_league_unavailable");
    });
    const games = await check("season_games", `/games?league=standard&season=${SEASON}`, rows => {
      requireThat(rows.length > 0, "season_games_empty");
      requireThat(rows.every(game => id(game.id) && Number(game.season) === SEASON && game.league === "standard"
        && Number.isFinite(Date.parse(game.date?.start))), "game_identity_or_season_mismatch");
      requireThat(new Set(rows.map(game => Number(game.id))).size === rows.length, "duplicate_game_ids");
    });
    // Select only a completed game after the documented 2026 regular-season start.
    // No historical-season request or fallback is permitted.
    const game = games.filter(row => Number(row.status?.short) === 3
      && row.date.start.slice(0, 10) >= "2026-10-20" && Date.parse(row.date.start) <= date.getTime())
      .sort((a, b) => Date.parse(b.date.start) - Date.parse(a.date.start))[0];
    requireThat(game, "no_completed_regular_season_sample");
    const home = Number(game.teams?.home?.id), away = Number(game.teams?.visitors?.id);
    requireThat(id(home) && id(away) && home !== away
      && numeric(game.scores?.home?.points) && numeric(game.scores?.visitors?.points), "incomplete_completed_game");
    const scores = new Map([[home, Number(game.scores.home.points)], [away, Number(game.scores.visitors.points)]]);
    report.sample_game = { provider_game_id: Number(game.id), start_time: game.date.start,
      home_team_id: home, away_team_id: away, home_score: scores.get(home), away_score: scores.get(away) };

    const teams = await check("team_directory", "/teams?league=standard", rows => {
      requireThat(rows.length >= 30 && rows.every(team => id(team.id) && typeof team.name === "string" && team.name), "incomplete_team_directory");
    });
    const teamIds = new Set(teams.map(team => Number(team.id)));
    requireThat(teamIds.has(home) && teamIds.has(away), "sample_team_missing_from_directory");
    await check("season_standings", `/standings?league=standard&season=${SEASON}`, rows => {
      requireThat(rows.every(row => Number(row.season) === SEASON && row.league === "standard" && teamIds.has(Number(row.team?.id))), "standings_scope_mismatch");
      requireThat(rows.length === 30 && new Set(rows.map(row => Number(row.team.id))).size === 30, "standings_not_30_distinct_teams");
    });
    await check("sample_team_roster", `/players?team=${home}&season=${SEASON}`, rows => {
      requireThat(rows.length > 0 && rows.every(player => id(player.id) && player.firstname && player.lastname), "sample_roster_empty_or_invalid");
    });
    await check("season_team_statistics", `/teams/statistics?id=${home}&season=${SEASON}`, rows => {
      requireThat(rows.length > 0 && rows.some(row => numeric(row.games) && Number(row.games) > 0 && numeric(row.points)), "season_team_statistics_empty_or_invalid");
      report.limits.push("Provider team-season totals may include multiple stages; regular-season filtering and per-game conversion need adapter validation.");
    });
    await check("sample_team_boxscore", `/games/statistics?id=${game.id}`, rows => {
      requireThat(rows.length === 2 && new Set(rows.map(row => Number(row.team?.id))).size === 2, "incomplete_team_boxscore");
      for (const row of rows) requireThat(scores.has(Number(row.team?.id))
        && numeric(row.statistics?.[0]?.points) && Number(row.statistics[0].points) === scores.get(Number(row.team.id)), "team_boxscore_score_mismatch");
    });
    await check("sample_player_boxscore", `/players/statistics?game=${game.id}`, rows => {
      const totals = new Map([[home, 0], [away, 0]]), players = new Map([[home, new Set()], [away, new Set()]]);
      requireThat(rows.length > 0, "player_boxscore_empty");
      for (const row of rows) {
        const team = Number(row.team?.id), player = Number(row.player?.id);
        requireThat(totals.has(team) && id(player) && Number(row.game?.id) === Number(game.id), "player_boxscore_identity_mismatch");
        requireThat(!players.get(team).has(player), "duplicate_player_boxscore_line");
        players.get(team).add(player);
        requireThat(row.points == null || numeric(row.points), "invalid_player_points");
        totals.set(team, totals.get(team) + Number(row.points ?? 0));
      }
      for (const team of [home, away]) requireThat(players.get(team).size >= 5 && totals.get(team) === scores.get(team), "player_points_do_not_reconcile");
    });
    report.status = "passed";
  } catch (error) {
    report.error = error instanceof ProbeError ? error.code : "probe_failed";
  }
  return report;
}

function markdown(report) {
  return `### API-NBA free-plan qualification: ${report.status}\n\n` +
    `Season: ${report.season} (provider ${report.provider_season}). Requests: ${report.request_count}/${MAX_REQUESTS}.\n\n` +
    "| Check | Result | HTTP | Rows |\n| --- | --- | --- | --- |\n" +
    report.checks.map(row => `| ${row.name} | ${row.status}${row.error ? `: ${row.error}` : ""} | ${row.http_status ?? "—"} | ${row.rows ?? "—"} |`).join("\n") +
    `\n\n${report.error ? `Failure: ${report.error}.\n\n` : ""}` + report.limits.map(value => `- ${value}`).join("\n") + "\n";
}

async function main() {
  const report = await qualify({ apiKey: process.env.API_SPORTS_KEY,
    log: row => console.log(JSON.stringify({ check: row })) });
  console.log(JSON.stringify(report));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown(report));
  process.exitCode = report.status === "passed" ? 0 : 1;
}
if (require.main === module) main().catch(() => { console.error("API-NBA qualification could not finish"); process.exitCode = 1; });
module.exports = { qualify, readJson, markdown, providerError, BASE, SEASON, MAX_REQUESTS, INTERVAL_MS };
