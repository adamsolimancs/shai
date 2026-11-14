"use strict";

const isFinalStatus = status => Boolean(status && /final/i.test(status));

function teamId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function tallyPlayerPoints(players) {
  const totals = new Map();
  for (const player of players) {
    // DNP and advanced-only lines can have no recorded points.
    if (player.points == null) continue;
    if (!Number.isSafeInteger(player.points) || player.points < 0) {
      throw new Error("Final boxscore has invalid player points");
    }
    const id = teamId(player.team_id);
    totals.set(id, (totals.get(id) ?? 0) + player.points);
  }
  return [...totals].map(([team_id, points]) => ({ team_id, points }));
}

function finalScoreIssue(home, away, playerTotals) {
  const homeId = teamId(home?.team_id);
  const awayId = teamId(away?.team_id);
  const validScore = score => Number.isSafeInteger(score) && score > 0;
  if (!homeId || !awayId || homeId === awayId || !validScore(home?.score) || !validScore(away?.score)) {
    return "invalid_final_scores";
  }
  const totals = new Map(playerTotals.map(row => [teamId(row.team_id), row.points]));
  for (const [id, points] of totals) {
    if (id !== homeId && id !== awayId && points !== 0) return "unmatched_player_team";
  }
  return totals.get(homeId) === home.score && totals.get(awayId) === away.score
    ? null : "player_points_mismatch";
}

module.exports = { isFinalStatus, tallyPlayerPoints, finalScoreIssue };
