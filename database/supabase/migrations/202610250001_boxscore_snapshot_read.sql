-- A single SQL statement gives the parent and every player the same MVCC snapshot.
-- STABLE is intentional: nested reads must retain the calling statement's snapshot.
CREATE OR REPLACE FUNCTION public.get_boxscore_snapshot(p_game_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'boxscore', to_jsonb(b),
    'players', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.player_id)
      FROM public.boxscore_players p
      WHERE p.game_id = b.game_id
    ), '[]'::jsonb)
  )
  FROM public.boxscores b
  WHERE b.game_id = p_game_id;
$$;

REVOKE ALL ON FUNCTION public.get_boxscore_snapshot(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.get_boxscore_snapshot(text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.get_boxscore_snapshot(text) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.get_boxscore_snapshot(text) TO service_role;
  END IF;
END;
$$;
