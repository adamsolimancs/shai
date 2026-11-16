"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadNba } = require("../morning");

test("a failed NBA game-list request makes no further NBA requests", async () => {
  const calls = [];
  const source = {
    async games() { calls.push("games"); throw new Error("NBA Stats timeout"); },
    async standings() { calls.push("standings"); },
    async playerStats() { calls.push("players"); },
    async boxscore() { calls.push("boxscore"); },
  };

  await assert.rejects(loadNba(source, "2026-11-15"), /NBA Stats timeout/);
  assert.deepEqual(calls, ["games"]);
});

test("NBA results reject disagreeing final scores and do not request today's live box", async () => {
  const requested = [];
  const game = {
    game_id: "0022600231", date: "2026-11-14",
    home_team_id: 1, away_team_id: 2, home_team_score: 108, away_team_score: 116,
  };
  const source = {
    async games() { return [{ ...game, game_id: "0022600237", date: "2026-11-15" }, game]; },
    async standings() { return []; },
    async playerStats() { return []; },
    async boxscore(id) {
      requested.push(id);
      return { game_date: game.date, home_team: { team_id: 1, score: 107 }, away_team: { team_id: 2, score: 116 } };
    },
  };

  await assert.rejects(loadNba(source, "2026-11-15"), /game list and box score disagree/);
  assert.deepEqual(requested, ["0022600231"]);
});

test("lagging aggregates leave validated final boxes eligible for publication", () => {
  const { prepareBatch } = require("../morning");
  const box = {
    game_id: "0022600231",
    game_date: "2026-11-14",
    observed_at: "2026-11-15T12:30:00Z",
    status: "Final",
    home_team: { team_id: 1, score: 108 },
    away_team: { team_id: 2, score: 116 },
    traditional_players: [
      { player_id: 1, player_name: "Home Player", team_id: 1, points: 108 },
      { player_id: 2, player_name: "Away Player", team_id: 2, points: 116 },
    ],
  };
  const aggregateError = "Season archives lag the completed slate";
  const batch = prepareBatch({ boxes: [box], aggregateError }, "2026-11-15");
  assert.equal(batch.aggregateError, aggregateError);
  assert.equal(batch.teamRows.length, 0);
  assert.equal(batch.playerRows.length, 0);
  assert.equal(batch.snapshots[0].p_game.home_team_score, 108);
  assert.equal(batch.snapshots[0].p_players.length, 2);
});
