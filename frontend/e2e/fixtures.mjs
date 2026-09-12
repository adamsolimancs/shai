// Intentionally small source-shaped payloads; optional fields stay absent.
export const observedAt = '2026-01-15T18:30:00Z';
export const team = { id: 1610612747, name: 'Lakers', city: 'Los Angeles', abbreviation: 'LAL', conference: 'West' };
export const game = {
  game_id: '0022500001', date: '2026-01-15', start_time: '2026-01-16T00:30:00Z',
  home_team_name: 'Lakers', home_team_score: 110, away_team_name: 'Celtics', away_team_score: 102, status: 'Final',
};
export const boxscore = {
  game_id: game.game_id, status: 'Final', game_date: game.date, start_time: game.start_time,
  home_team: { team_id: team.id, team_name: 'Lakers', team_abbreviation: 'LAL', score: 110, is_home: true, leaders: [] },
  away_team: { team_id: 1610612738, team_name: 'Celtics', team_abbreviation: 'BOS', score: 102, is_home: false, leaders: [] },
  officials: [], line_score: [], team_totals: [], starter_bench: [], traditional_players: [], advanced_players: [],
};
export const career = [{
  player_id: 2544, season_id: '2025-26', league_id: '00', team_id: team.id, team_abbreviation: 'LAL',
  games_played: 10, games_started: 10, minutes: 350, points: 250, rebounds: 80, assists: 70,
  steals: 10, blocks: 5, turnovers: 20, player_age: 41,
}];
export const suggestions = [
  { type: 'player', id: 2544, name: 'LeBron James', subtitle: 'LAL', url: '/players/2544' },
  { type: 'team', id: team.id, name: 'Los Angeles Lakers', subtitle: 'LAL', url: '/teams/lal' },
];
