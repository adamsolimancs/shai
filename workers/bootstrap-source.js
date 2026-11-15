"use strict";

const nba = require("./worker-live");

function normalizeV3Boxscore(traditional, summary, gameId, observedAt) {
  const stats = traditional.boxScoreTraditional;
  const game = summary.boxScoreSummary;
  if (!stats || !game || stats.gameId !== gameId || game.gameId !== gameId) {
    throw new Error("V3 boxscore returned a missing or mismatched game ID");
  }
  const teams = ["homeTeam", "awayTeam"].map((side) => {
    const team = stats[side];
    const info = game[side];
    if (!team || !info || team.teamId !== info.teamId || !Array.isArray(team.players)
      || !Number.isFinite(info.score) || !game.gameStatusText) {
      throw new Error("Invalid V3 boxscore team payload");
    }
    return {
      ...info, statistics: team.statistics,
      players: team.players.map(player => ({ ...player,
        name: [player.firstName, player.familyName].filter(Boolean).join(" "),
      })),
    };
  });
  const players = teams.flatMap(nba.buildCdnPlayers);
  if (game.gameStatus === 3 && !players.length) throw new Error("Final boxscore has no players");
  return {
    game_id: gameId, observed_at: observedAt, status: game.gameStatusText,
    game_date: game.gameEt?.slice(0, 10) || game.gameTimeUTC?.slice(0, 10),
    start_time: game.gameTimeUTC || null, arena: game.arena?.arenaName || null,
    attendance: game.attendance ?? null,
    officials: (game.officials || []).map(row => row.name || [row.firstName, row.familyName].filter(Boolean).join(" ")),
    home_team: nba.buildCdnTeamCard(teams[0], true, players),
    away_team: nba.buildCdnTeamCard(teams[1], false, players),
    line_score: nba.buildCdnLineScore(...teams), team_totals: teams.map(nba.buildCdnTeamTotals),
    traditional_players: players, advanced_players: [], starter_bench: [],
  };
}

function createSource() {
  return {
    teams: nba.fetchStaticTeams,
    players: nba.fetchStaticPlayers,
    games: season => nba.fetchGames(season),
    standings: season => nba.fetchLeagueStandingsRows(season),
    playerStats: season => nba.fetchLeagueDashPlayerStats(season),
    async teamStats(season) {
      const observedAt = new Date().toISOString();
      return (await nba.fetchLeagueDashTeamStats(season, "Base")).map(row => ({ ...row, observed_at: observedAt }));
    },
    leaders: (season, category) => nba.fetchLeagueLeadersRows(season, "Regular Season", "PerGame", category),
    async scoreboard(date, season) {
      const observedAt = new Date().toISOString();
      const payload = await nba.statsRequest(`https://stats.nba.com/stats/scoreboardv3?LeagueID=00&GameDate=${date}`);
      const board = payload.scoreboard;
      if (!board || !Array.isArray(board.games) || board.gameDate !== date) {
        throw new Error("Scoreboard is missing or belongs to another date");
      }
      return board.games.map(game => ({ ...nba.normalizeLiveScoreboardGame(game, season), observed_at: observedAt }));
    },
    async boxscore(gameId) {
      const observedAt = new Date().toISOString();
      const traditional = await nba.statsRequest(`https://stats.nba.com/stats/boxscoretraditionalv3?GameID=${gameId}&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0&RangeType=0`);
      const summary = await nba.statsRequest(`https://stats.nba.com/stats/boxscoresummaryv3?GameID=${gameId}`);
      return normalizeV3Boxscore(traditional, summary, gameId, observedAt);
    },
  };
}
module.exports = { createSource, normalizeV3Boxscore };
