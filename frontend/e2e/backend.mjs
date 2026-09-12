import { createServer } from 'node:http';
import { boxscore, career, game, observedAt, suggestions, team } from './fixtures.mjs';

let state = {};
let unknown = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:18080');
  const send = (status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  if (url.pathname === '/health') return send(200, { ok: true });
  if (url.pathname === '/__scenario' && req.method === 'POST') {
    let body = ''; for await (const chunk of req) body += chunk;
    state = JSON.parse(body); unknown = []; return send(200, state);
  }
  if (url.pathname === '/__unknown') return send(200, unknown);
  const envelope = (data, mode) => mode === 'failed'
    ? send(503, { ok: false, error: { code: 'UNAVAILABLE', message: 'Fixture source unavailable' } })
    : send(200, { ok: true, data, meta: { source: 'db', as_of: mode === 'unknown' ? null : observedAt, stale: mode === 'stale' || mode === 'unknown' } });
  const path = url.pathname;
  // Auxiliary homepage requests made while Next collects build-time page data.
  if (path === '/v1/news' || path === '/v1/players/stats') return envelope([], 'fresh');
  if (path === '/v1/meta') return envelope({ supported_seasons: ['2025-26'] }, 'fresh');
  if (path === '/v1/search/suggestions') return envelope(state.search === 'empty' ? [] : suggestions, state.search);
  if (path === '/v1/games') {
    const mode = url.searchParams.has('date_from') ? (state.tonight ?? state.scores) : state.scores;
    const data = mode === 'empty' ? [] : [{ ...game, ...(url.searchParams.has('date_from') ? { date: url.searchParams.get('date_from'), start_time: `${url.searchParams.get('date_from')}T23:30:00Z`, status: 'Scheduled', home_team_score: 0, away_team_score: 0 } : {}) }];
    return envelope(data, mode);
  }
  if (path.startsWith('/v1/boxscores/')) {
    if (state.boxscore === 'empty') return send(404, { ok: false, error: { code: 'BOX_SCORE_NOT_FOUND', message: 'Boxscore unavailable in cache or database.' } });
    const data = state.boxscore === 'partial' ? boxscore : {
      ...boxscore, traditional_players: [{ player_id: 2544, player_name: 'LeBron James', team_id: team.id, team_abbreviation: 'LAL', minutes: '35:00', points: 25, rebounds: 8, assists: 7 }],
    };
    return envelope(data, state.boxscore);
  }
  if (path === '/v1/resolve') return envelope({ player: state.player === 'empty' ? null : { id: 2544, name: 'LeBron James', abbreviation: 'LAL' } }, state.player);
  if (path === '/v1/players') return envelope([], state.player);
  if (path.match(/^\/v1\/players\/2544\/career$/)) return envelope(state.player === 'partial' || url.searchParams.get('season_type') === 'Playoffs' ? [] : career, state.player);
  if (path.match(/^\/v1\/players\/2544\/(info|bio)$/)) return envelope(null, state.player);
  if (path.match(/^\/v1\/players\/2544\/(gamelog|awards)$/)) return envelope([], state.player);
  if (path === '/v1/teams') return envelope(state.team === 'empty' ? [] : [{ ...team, ...(state.team === 'partial' ? {} : { division: 'Pacific' }) }], state.team);
  if (path === '/v1/league_standings') return envelope(state.team === 'partial' ? [] : [{ team_id: team.id, conference: 'West', wins: 10, losses: 5, win_pct: 0.667, team_name: 'Los Angeles Lakers' }], state.team);
  if (path.match(/^\/v1\/teams\/\d+\/details$/)) return envelope(state.team === 'partial' ? null : { team_id: team.id, head_coach: 'Fixture Coach', championships: [], conference_titles: [], division_titles: [], hall_of_famers: [], retired_numbers: [], social_sites: {} }, state.team);
  if (path.match(/^\/v1\/teams\/\d+\/(stats|history)$/)) return envelope([], state.team);
  unknown.push(req.url);
  return send(500, { ok: false, error: { message: `Unconfigured fixture: ${req.url}` } });
});
server.listen(18080, '127.0.0.1');
