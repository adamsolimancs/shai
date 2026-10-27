#!/usr/bin/env node
"use strict";

// Read-only live comparison. Provider credentials are sent only to API-SPORTS.
const { appendFileSync } = require("node:fs");
const { readJson, providerError, BASE, INTERVAL_MS } = require("./check-api-nba");
const MAX_REQUESTS = 10;
const SAMPLE_INTERVAL_MS = 30000;
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const aliases = { GS: "GSW", NY: "NYK", NO: "NOP", SA: "SAS", UTAH: "UTA", WSH: "WAS", PHO: "PHX" };
const codes = new Set("ATL BOS BKN CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS".split(" "));
const teamCode = value => { const result = aliases[value] ?? value; return codes.has(result) ? result : null; };
const number = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const textClock = value => typeof value === "string" && /^(\d{1,2}:)?\d{1,2}(\.\d+)?$/.test(value) ? value : null;
const nyDate = date => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

function normalizeApi(rows, date) {
  return rows.filter(row => row && row.league === "standard" && Number(row.season) === 2026
    && Number.isFinite(Date.parse(row.date?.start)) && nyDate(new Date(row.date.start)) === date).map(row => {
    const home = teamCode(row.teams?.home?.code), away = teamCode(row.teams?.visitors?.code);
    return { id: number(row.id), key: home && away ? `${away}@${home}` : null,
      home_id: number(row.teams?.home?.id), away_id: number(row.teams?.visitors?.id),
      home: number(row.scores?.home?.points), away: number(row.scores?.visitors?.points),
      status: ({ 1: "pre", 2: "in", 3: "post", 4: "postponed", 5: "delayed", 6: "cancelled" })[row.status?.short] ?? "unknown",
      period: number(row.periods?.current), clock: textClock(row.status?.clock),
    };
  }).filter(row => row.id && row.key);
}

function normalizeEspn(payload) {
  return (payload.events ?? []).map(event => {
    const teams = event.competitions?.[0]?.competitors ?? [];
    const home = teams.find(row => row.homeAway === "home"), away = teams.find(row => row.homeAway === "away");
    const h = teamCode(home?.team?.abbreviation), a = teamCode(away?.team?.abbreviation);
    return { id: number(event.id), key: h && a ? `${a}@${h}` : null,
      home: number(home?.score), away: number(away?.score), status: event.status?.type?.state,
      period: number(event.status?.period), clock: textClock(event.status?.displayClock),
    };
  }).filter(row => row.key);
}

function comparisons(provider, before, after) {
  return provider.map(game => {
    const references = [before, after].flatMap(sample => (sample?.games ?? []).filter(row => row.key === game.key));
    const sameScore = row => game.home !== null && game.away !== null && row.home === game.home && row.away === game.away;
    const nearest = references.find(sameScore) ?? references.at(-1);
    return { key: game.key, provider_score: [game.away, game.home], provider_status: game.status,
      provider_period: game.period, provider_clock: game.clock,
      reference_available: references.length > 0,
      score_matches_reference_window: references.length ? references.some(sameScore) : null,
      status_matches_reference_window: references.length ? references.some(row => row.status === game.status) : null,
      reference_score: nearest ? [nearest.away, nearest.home] : null,
      reference_period: nearest?.period ?? null, reference_clock: nearest?.clock ?? null };
  });
}

async function evaluate({ apiKey, fetchImpl = fetch, sleep = pause, now = () => Date.now(), log = () => {} } = {}) {
  const date = nyDate(new Date(now()));
  const report = { status: "unavailable", date, checked_at: new Date(now()).toISOString(), provider_requests: 0,
    quota_remaining: null, checks: [], samples: [], live_updates_observed: false,
    limits: ["ESPN is a comparison feed, not a broadcast ground truth.", "Clock differences are game time, not a measured wall-clock delivery delay."] };
  let lastStart = null;
  const record = value => log(JSON.parse(JSON.stringify(value)));
  async function request(path) {
    if (report.provider_requests >= MAX_REQUESTS || report.quota_remaining === 0) throw new Error("request_budget_exhausted");
    if (lastStart !== null) await sleep(Math.max(0, INTERVAL_MS - (now() - lastStart)));
    lastStart = now();
    const row = { path, requested_at: new Date(now()).toISOString(), http_status: null };
    report.provider_requests++;
    try {
      const response = await fetchImpl(new URL(path, BASE), { method: "GET", redirect: "error",
        headers: { "x-apisports-key": apiKey }, signal: AbortSignal.timeout(15000) });
      row.http_status = response.status;
      const remaining = response.headers.get("x-ratelimit-requests-remaining");
      if (remaining !== null && /^\d+$/.test(remaining)) report.quota_remaining = Number(remaining);
      else if (path !== "/status" && report.quota_remaining !== null) report.quota_remaining = Math.max(0, report.quota_remaining - 1);
      if (response.status === 429) report.quota_remaining = 0;
      if (!response.ok) throw new Error(response.status === 429 ? "rate_limited" : `http_${response.status}`);
      const payload = await readJson(response);
      if (!payload || typeof payload !== "object" || !("errors" in payload) || !("response" in payload)) throw new Error("invalid_envelope");
      if (payload.errors && Object.keys(payload.errors).length) {
        row.error = providerError(payload.errors);
        row.error_years_mentioned = [...new Set(JSON.stringify(payload.errors).match(/\b20\d{2}\b/g) ?? [])];
        return null;
      }
      row.rows = Array.isArray(payload.response) ? payload.response.length : 1;
      return payload.response;
    } catch (error) {
      row.error = /^(http_\d{3}|rate_limited|invalid_envelope|invalid_json|response_too_large|request_timeout)$/.test(error.message) ? error.message : "request_failed";
      return null;
    } finally {
      row.received_at = new Date(now()).toISOString();
      row.duration_ms = now() - lastStart;
      report.checks.push(row); record({ check: row });
    }
  }
  async function reference() {
    const start = now();
    try {
      const response = await fetchImpl(`${ESPN}?dates=${date.replaceAll("-", "")}`, {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      const games = normalizeEspn(await readJson(response));
      if (!games.length) throw new Error();
      return { requested_at: new Date(start).toISOString(), received_at: new Date(now()).toISOString(), games };
    } catch { return { requested_at: new Date(start).toISOString(), received_at: new Date(now()).toISOString(), error: "reference_unavailable", games: [] }; }
  }
  async function sample(path) {
    const before = await reference();
    const rows = await request(path);
    const after = await reference();
    const games = Array.isArray(rows) ? normalizeApi(rows, date) : [];
    const snapshot = { received_at: new Date(now()).toISOString(), path, games, reference_before: before,
      reference_after: after, comparison: comparisons(games, before, after) };
    report.samples.push(snapshot); record({ sample: snapshot });
    return games;
  }
  try {
    if (typeof apiKey !== "string" || !apiKey.trim()) throw new Error("missing_api_sports_key");
    apiKey = apiKey.trim();
    const account = await request("/status");
    if (!account?.subscription || account.subscription.active === false) throw new Error("subscription_unavailable");
    if (report.quota_remaining === null && Number.isFinite(Number(account.requests?.limit_day)) && Number.isFinite(Number(account.requests?.current))) {
      report.quota_remaining = Math.max(0, Number(account.requests.limit_day) - Number(account.requests.current));
    }
    report.plan = ["free", "pro", "ultra", "mega"].includes(String(account.subscription.plan).toLowerCase()) ? String(account.subscription.plan).toLowerCase() : "other";
    const first = await sample("/games?live=all");
    const directory = new Map(first.map(game => [game.id, game]));
    report.date_samples = [];
    for (const day of new Set([date, new Date(now()).toISOString().slice(0, 10)])) {
      const before = await reference();
      const rows = await request(`/games?date=${day}&league=standard`);
      const after = await reference();
      const games = Array.isArray(rows) ? normalizeApi(rows, date) : [];
      for (const game of games) directory.set(game.id, game);
      const dateSample = { date: day, received_at: new Date(now()).toISOString(), games,
        reference_before: before, reference_after: after, comparison: comparisons(games, before, after) };
      report.date_samples.push(dateSample); record({ date_sample: dateSample });
    }
    report.current_day_games = [...directory.values()]; record({ current_day_games: report.current_day_games });
    if (!directory.size) { report.error = "no_accessible_current_day_game_data"; return report; }
    const live = first.find(game => game.status === "in") ?? report.current_day_games.find(game => game.status === "in");
    if (!live) { report.error = "no_accessible_live_game_data"; return report; }
    const path = first.some(game => game.status === "in") ? "/games?live=all" : `/games?id=${live.id}`;
    for (let i = 0; i < 3; i++) {
      const last = Date.parse(report.samples.at(-1).received_at);
      await sleep(Math.max(0, SAMPLE_INTERVAL_MS - (now() - last)));
      await sample(path);
    }
    report.live_updates_observed = report.samples.some((current, i) => i > 0 && current.games.some(game => {
      const previous = report.samples[i - 1].games.find(row => row.id === game.id);
      return previous && ["home", "away", "period", "clock", "status"].some(key => game[key] !== previous[key]);
    }));
    // Prefer a final game so separately fetched team/player totals can be reconciled.
    const boxGame = report.current_day_games.find(game => game.status === "post") ?? live;
    const teamStats = await request(`/games/statistics?id=${boxGame.id}`);
    const playerStats = await request(`/players/statistics?game=${boxGame.id}`);
    const finalRows = await request(`/games?id=${boxGame.id}`);
    const latest = Array.isArray(finalRows) ? normalizeApi(finalRows, date)[0] : null;
    if (latest && Array.isArray(teamStats) && Array.isArray(playerStats)) {
      report.boxscore = { key: latest.key, status: latest.status, player_rows: playerStats.length,
        teams: [latest.away_id, latest.home_id].map(team => ({ team_id: team,
          game_points: team === latest.home_id ? latest.home : latest.away,
          team_stat_points: number(teamStats.find(row => Number(row.team?.id) === team)?.statistics?.[0]?.points),
          player_points_sum: playerStats.filter(row => Number(row.team?.id) === team).reduce((total, row) => total + (number(row.points) ?? 0), 0) })) };
    }
    const results = report.samples.flatMap(snapshot => snapshot.comparison).filter(row => row.reference_available);
    report.comparisons = { total: results.length, score_matches: results.filter(row => row.score_matches_reference_window).length,
      status_matches: results.filter(row => row.status_matches_reference_window).length };
    report.status = results.length ? "measured" : "reference_unavailable";
  } catch (error) { report.error = /^(missing_api_sports_key|subscription_unavailable|request_budget_exhausted)$/.test(error.message) ? error.message : "evaluation_failed"; }
  return report;
}

async function main() {
  const report = await evaluate({ apiKey: process.env.API_SPORTS_KEY, log: row => console.log(JSON.stringify(row)) });
  console.log(JSON.stringify({ report }));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### API-NBA live evaluation\n\nResult: ${report.status}. API requests: ${report.provider_requests}/${MAX_REQUESTS}. ` +
    `Live changes observed: ${report.live_updates_observed}.\n\n${report.error ?? ""}\n\n` +
    (report.comparisons ? `Score matches: ${report.comparisons.score_matches}/${report.comparisons.total}; status matches: ${report.comparisons.status_matches}/${report.comparisons.total}.\n` : "") +
    report.limits.map(value => `- ${value}`).join("\n") + "\n");
  process.exitCode = report.status === "measured" ? 0 : 1;
}
if (require.main === module) main().catch(() => { console.error("Live evaluation could not finish"); process.exitCode = 1; });
module.exports = { evaluate, normalizeApi, normalizeEspn, comparisons, MAX_REQUESTS };
