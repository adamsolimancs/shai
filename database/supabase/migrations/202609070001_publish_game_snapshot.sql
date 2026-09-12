-- Each RPC call is a single PostgreSQL transaction. A failed/cancelled statement
-- rolls back games, boxscores, and the full player replacement together.
CREATE OR REPLACE FUNCTION public.publish_game_snapshot(
  p_game jsonb,
  p_boxscore jsonb,
  p_players jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  snapshot_game_id text;
  player_count integer;
BEGIN
  IF jsonb_typeof(p_game) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_boxscore) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_players) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'snapshot requires game/boxscore objects and a players array' USING ERRCODE = '22023';
  END IF;
  snapshot_game_id := p_game->>'game_id';
  IF snapshot_game_id IS NULL OR btrim(snapshot_game_id) = ''
     OR (p_boxscore->>'game_id') IS DISTINCT FROM snapshot_game_id THEN
    RAISE EXCEPTION 'snapshot game IDs must match and be nonempty' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_players) AS item
    WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
       OR (item->>'game_id') IS DISTINCT FROM snapshot_game_id
       OR NULLIF(btrim(item->>'player_id'), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'snapshot player IDs must be nonempty and game IDs must match' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT item->>'player_id')
      FROM jsonb_array_elements(p_players) AS item) THEN
    RAISE EXCEPTION 'snapshot contains duplicate player IDs' USING ERRCODE = '22023';
  END IF;

  -- Serializes same-game publishers even when the parent row does not yet exist.
  PERFORM pg_advisory_xact_lock(hashtextextended(snapshot_game_id, 0));

  INSERT INTO public.games
  SELECT * FROM jsonb_populate_record(NULL::public.games, p_game)
  ON CONFLICT (game_id) DO UPDATE SET
    date = CASE WHEN p_game ? 'date' THEN EXCLUDED.date ELSE games.date END,
    start_time = CASE WHEN p_game ? 'start_time' THEN EXCLUDED.start_time ELSE games.start_time END,
    home_team_id = CASE WHEN p_game ? 'home_team_id' THEN EXCLUDED.home_team_id ELSE games.home_team_id END,
    home_team_name = CASE WHEN p_game ? 'home_team_name' THEN EXCLUDED.home_team_name ELSE games.home_team_name END,
    home_team_score = CASE WHEN p_game ? 'home_team_score' THEN EXCLUDED.home_team_score ELSE games.home_team_score END,
    away_team_id = CASE WHEN p_game ? 'away_team_id' THEN EXCLUDED.away_team_id ELSE games.away_team_id END,
    away_team_name = CASE WHEN p_game ? 'away_team_name' THEN EXCLUDED.away_team_name ELSE games.away_team_name END,
    away_team_score = CASE WHEN p_game ? 'away_team_score' THEN EXCLUDED.away_team_score ELSE games.away_team_score END,
    season = CASE WHEN p_game ? 'season' THEN EXCLUDED.season ELSE games.season END;

  INSERT INTO public.boxscores
  SELECT * FROM jsonb_populate_record(NULL::public.boxscores, p_boxscore)
  ON CONFLICT (game_id) DO UPDATE SET
    status = EXCLUDED.status,
    game_date = EXCLUDED.game_date,
    start_time = EXCLUDED.start_time,
    arena = EXCLUDED.arena,
    attendance = EXCLUDED.attendance,
    officials = EXCLUDED.officials,
    home_team = EXCLUDED.home_team,
    away_team = EXCLUDED.away_team,
    line_score = EXCLUDED.line_score,
    team_totals = EXCLUDED.team_totals;

  DELETE FROM public.boxscore_players WHERE game_id = snapshot_game_id;
  INSERT INTO public.boxscore_players
  SELECT * FROM jsonb_populate_recordset(NULL::public.boxscore_players, p_players);
  GET DIAGNOSTICS player_count = ROW_COUNT;
  RETURN jsonb_build_object('players_upserted', player_count);
END;
$$;

REVOKE ALL ON FUNCTION public.publish_game_snapshot(jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_game_snapshot(jsonb, jsonb, jsonb) TO service_role;
