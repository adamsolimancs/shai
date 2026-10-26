"use strict";
const observed = "2026-10-25T01:00:00.000Z";
function fixtureSource() {
  const calls = [];
  const game = { game_id: "0022600001", date: "2026-10-24", start_time: "2026-10-25T00:00:00Z", home_team_id: 1, away_team_id: 2, home_team_name: "One", away_team_name: "Two", home_team_score: 101, away_team_score: 99, observed_at: observed };
  const box = { game_id: game.game_id, game_date: game.date, start_time: game.start_time, status: "Final", observed_at: observed,
    home_team: { team_id: 1, team_name: "One", score: 101, is_home: true, leaders: [] }, away_team: { team_id: 2, team_name: "Two", score: 99, is_home: false, leaders: [] },
    traditional_players: [{ player_id: 102, player_name: "New Rookie", team_id: 1, points: 30 }], advanced_players: [], line_score: [], team_totals: [], officials: [] };
  const wrap = (name, fn) => async (...args) => { calls.push({ name, args }); return fn(...args); };
  return { calls, game, box,
    teams: wrap("teams", () => Array.from({ length: 30 }, (_, index) => ({ id: index + 1, name: `Team ${index + 1}`, city: "Fixture", abbreviation: `T${index + 1}` }))),
    players: wrap("players", () => [{ PERSON_ID: 100, DISPLAY_FIRST_LAST: "Active Player", ROSTERSTATUS: "Active" }, { PERSON_ID: 101, DISPLAY_FIRST_LAST: "Historic Player", ROSTERSTATUS: "Inactive" }]),
    games: wrap("games", () => [game]), scoreboard: wrap("scoreboard", () => []),
    standings: wrap("standings", () => [{ TeamID: 1, Conference: "East", Division: "Atlantic", WINS: 1, LOSSES: 0, WinPCT: 1 }]),
    playerStats: wrap("playerStats", () => [{ PLAYER_ID: 102, PLAYER_NAME: "New Rookie", TEAM_ID: 1, GP: 1, PTS: 30 }]),
    teamStats: wrap("teamStats", () => [{ TEAM_ID: 1, TEAM_NAME: "One", PTS: 101, observed_at: observed }]),
    leaders: wrap("leaders", (_season, category) => [{ PLAYER_ID: 102, PLAYER: "New Rookie", TEAM_ID: 1, RANK: 1, [category]: 30 }]),
    boxscore: wrap("boxscore", () => structuredClone(box)),
  };
}
module.exports = { fixtureSource, observed };
