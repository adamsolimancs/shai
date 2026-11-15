#!/usr/bin/env python3
"""Integration check in a disposable, socket-only local PostgreSQL cluster.

Requires initdb, pg_ctl and psql on PATH. Never accepts a database URL.
"""
import asyncio
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from build_baseline import render


class BaselineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for binary in ("initdb", "pg_ctl", "psql"):
            if not shutil.which(binary):
                raise RuntimeError(f"Required local PostgreSQL binary missing: {binary}")
        cls.tmp = tempfile.TemporaryDirectory(prefix="shai-db-", dir="/tmp")
        cls.addClassCleanup(cls.tmp.cleanup)
        cls.data = str(Path(cls.tmp.name) / "data")
        cls.env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
        cls.command(["initdb", "-D", cls.data, "-A", "trust", "-U", "postgres", "--no-locale"])
        cls.command(["pg_ctl", "-D", cls.data, "-l", str(Path(cls.tmp.name) / "postgres.log"), "-o", f"-h '' -k {cls.tmp.name}", "-w", "start"])
        cls.addClassCleanup(cls.cleanup)
        cls.sql(render())

    @classmethod
    def cleanup(cls):
        cls.command(["pg_ctl", "-D", cls.data, "-m", "immediate", "-w", "stop"])

    @classmethod
    def command(cls, args):
        result = subprocess.run(args, env=cls.env, text=True, capture_output=True)
        if result.returncode:
            raise RuntimeError(f"{args[0]} failed:\n{result.stdout}\n{result.stderr}")

    @classmethod
    def sql(cls, query, *, succeeds=True, database="postgres"):
        result = subprocess.run(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-h", cls.tmp.name, "-U", "postgres", database], input=query, text=True, capture_output=True, env=cls.env)
        if succeeds and result.returncode:
            raise AssertionError(result.stderr)
        if not succeeds and not result.returncode:
            raise AssertionError("Expected SQL to fail")
        return result.stdout.strip() if succeeds else result.stderr

    def setUp(self):
        self.sql("TRUNCATE public.games, public.boxscores, public.boxscore_players CASCADE; INSERT INTO public.players(player_id) VALUES ('p1'), ('p2') ON CONFLICT DO NOTHING;")

    def publish(self, *, score=10, players=None, game_id="g1"):
        if players is None:
            players = [{"game_id": game_id, "player_id": "p1", "points": score}]
        game = {"game_id": game_id, "home_team_score": score}
        boxscore = {"game_id": game_id, "status": "live", "home_team": json.dumps({"score": score})}
        literals = ["'" + json.dumps(value).replace("'", "''") + "'::jsonb" for value in (game, boxscore, players)]
        return "SELECT public.publish_game_snapshot(" + ",".join(literals) + ");"

    def state(self):
        return self.sql("SELECT jsonb_build_array((SELECT jsonb_agg(g) FROM games g), (SELECT jsonb_agg(b) FROM boxscores b), (SELECT jsonb_agg(p ORDER BY player_id) FROM boxscore_players p));")

    def test_reconstruction_and_functions(self):
        self.assertEqual(int(self.sql("SELECT count(*) FROM pg_tables WHERE schemaname='public';")), render().count("CREATE TABLE public."))
        self.assertEqual(self.sql("SELECT bool_and(NOT rowsecurity) FROM pg_tables WHERE schemaname='public';"), "t")
        output = self.sql(self.publish())
        self.assertIn('"players_upserted": 1', output)
        self.sql("SELECT * FROM public.search_suggestions('test', 8);")

    def test_application_adapter_preserves_ids_and_writes_timestamps(self):
        from app.config import Settings
        from app.database import DatabaseClient

        async def exercise():
            client = DatabaseClient(Settings(
                _env_file=None,
                database_url=f"postgresql://postgres@/postgres?host={self.tmp.name}",
            ))
            try:
                await client.upsert("user_accounts", [{
                    "auth_user_id": "001234567890123456789",
                    "email": "adapter@example.test",
                    "name": "true",
                    "updated_at": "2026-10-16T00:00:00+00:00",
                }], on_conflict="auth_user_id")
                account = await client.select_one("user_accounts", filters={
                    "auth_user_id": "eq.001234567890123456789",
                })
                self.assertEqual(account["auth_user_id"], "001234567890123456789")
                self.assertEqual(account["name"], "true")
                self.assertEqual(account["updated_at"], "2026-10-16T00:00:00+00:00")
                self.assertIsNotNone(account["created_at"])
                await client.upsert("api_snapshots", [{
                    "cache_key": "adapter-test", "payload": '{"ok": true}',
                    "updated_at": "2026-10-16T00:00:00+00:00",
                    "observed_at": "2026-10-15T23:00:00+00:00",
                }], on_conflict="cache_key")
                snapshot = await client.select_one("api_snapshots", filters={
                    "cache_key": "eq.adapter-test",
                })
                self.assertEqual(json.loads(snapshot["payload"]), {"ok": True})
                self.assertEqual(snapshot["observed_at"], "2026-10-15T23:00:00+00:00")
            finally:
                await client.close()

        asyncio.run(exercise())

    def test_oauth_migration_upgrades_legacy_supabase_accounts(self):
        self.sql("DROP DATABASE IF EXISTS legacy; CREATE DATABASE legacy;")
        legacy_id = "2f0c6a52-3f43-4c1e-9d55-5f3b0f1d7a10"
        self.sql(f"""
          CREATE SCHEMA auth;
          CREATE TABLE auth.users (id uuid PRIMARY KEY);
          CREATE TABLE public.user_accounts (
            auth_user_id uuid PRIMARY KEY,
            name text, username text UNIQUE, email text NOT NULL UNIQUE,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
          );
          ALTER TABLE public.user_accounts ADD CONSTRAINT user_accounts_auth_user_id_fkey
            FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE;
          INSERT INTO auth.users VALUES ('{legacy_id}');
          INSERT INTO public.user_accounts (auth_user_id, email) VALUES ('{legacy_id}', 'legacy@example.test');
        """, database="legacy")
        migration = Path(__file__).resolve().parents[1] / "supabase/migrations/202610160001_oauth_account_ids.sql"
        self.sql(migration.read_text(), database="legacy")
        self.assertEqual(self.sql("""
          SELECT format_type(atttypid, atttypmod) FROM pg_attribute
          WHERE attrelid = 'public.user_accounts'::regclass AND attname = 'auth_user_id';
        """, database="legacy"), "text")
        self.assertEqual(self.sql("SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND conrelid = 'public.user_accounts'::regclass;", database="legacy"), "0")
        self.assertEqual(self.sql("SELECT auth_user_id FROM public.user_accounts;", database="legacy"), legacy_id)
        self.sql("INSERT INTO public.user_accounts (auth_user_id, email) VALUES ('google:001234567890', 'new@example.test');", database="legacy")

    def test_account_sync_claims_legacy_rows_and_persists_profiles(self):
        from app.config import Settings
        from app.database import DatabaseClient
        from app.services.store import update_user_account_profile, upsert_user_account

        legacy_id = "8b1b4d7e-6f0a-4c0f-a7c2-1a2b3c4d5e6f"
        self.sql(f"""
          DELETE FROM public.user_accounts;
          INSERT INTO public.user_accounts (auth_user_id, email, name, username)
          VALUES ('{legacy_id}', 'legacy@example.test', 'Saved Name', 'saved_user');
        """)

        async def exercise():
            client = DatabaseClient(Settings(
                _env_file=None,
                database_url=f"postgresql://postgres@/postgres?host={self.tmp.name}",
            ))
            try:
                subject = "google:001234567890123456789"
                claimed = await upsert_user_account(
                    client, auth_user_id=subject, email="Legacy@Example.test",
                    email_verified=True, name="Google Name",
                )
                self.assertEqual(claimed, {
                    "auth_user_id": subject, "email": "legacy@example.test",
                    "name": "Saved Name", "username": "saved_user",
                })
                updated = await update_user_account_profile(
                    client, auth_user_id=subject, name="Edited", username="Edited_User",
                )
                self.assertEqual(updated["username"], "edited_user")
                again = await upsert_user_account(
                    client, auth_user_id=subject, email="legacy@example.test",
                    email_verified=True, name="Google Name",
                )
                self.assertEqual((again["name"], again["username"]), ("Edited", "edited_user"))
                self.assertIsNone(await update_user_account_profile(
                    client, auth_user_id="google:missing", name="Nobody", username=None,
                ))
            finally:
                await client.close()

        asyncio.run(exercise())
        self.assertEqual(self.sql("SELECT count(*) FROM public.user_accounts;"), "1")

    def test_replacement_idempotence_and_empty_players(self):
        self.sql(self.publish())
        snapshot = self.state()
        self.sql(self.publish())
        self.assertEqual(snapshot, self.state())
        self.sql(self.publish(score=20, players=[{"game_id": "g1", "player_id": "p2", "points": 20}]))
        self.assertEqual(self.sql("SELECT player_id FROM boxscore_players;"), "p2")
        self.sql(self.publish(players=[]))
        self.assertEqual(self.sql("SELECT count(*) FROM boxscore_players;"), "0")

    def test_snapshot_reads_are_consistent_during_concurrent_publication(self):
        import asyncpg
        from app.config import Settings
        from app.database import DatabaseClient
        from app.services.store import fetch_boxscore

        self.sql(self.publish())
        self.assertEqual(self.sql("SELECT provolatile FROM pg_proc WHERE oid = 'public.get_boxscore_snapshot(text)'::regprocedure;"), "s")

        async def exercise():
            url = f"postgresql://postgres@/postgres?host={self.tmp.name}"
            writer = await asyncpg.connect(url)
            reader = DatabaseClient(Settings(_env_file=None, database_url=url))
            try:
                await reader.check_readiness()
                self.assertIsNone(await fetch_boxscore(reader, "missing"))
                async with writer.transaction():
                    await writer.execute(self.publish(score=20))
                    old = await asyncio.wait_for(fetch_boxscore(reader, "g1"), 2)
                    self.assertEqual(old["home_team"]["score"], 10)
                    self.assertEqual(old["traditional_players"][0]["points"], 10)
                new = await fetch_boxscore(reader, "g1")
                self.assertEqual(new["home_team"]["score"], 20)
                self.assertEqual(new["traditional_players"][0]["points"], 20)
                games = await reader.select_games(filters={"game_id": "eq.g1"})
                self.assertEqual(games[0]["status"], "live")
                self.assertEqual(games[0]["home_team_score"], 20)

                async def publish_many():
                    for score in range(30, 80):
                        await writer.execute(self.publish(score=score))

                async def read_many():
                    for _ in range(80):
                        snapshot = await fetch_boxscore(reader, "g1")
                        self.assertEqual(snapshot["home_team"]["score"], snapshot["traditional_players"][0]["points"])

                await asyncio.gather(publish_many(), read_many())
                await writer.execute(self.publish(players=[]))
                self.assertEqual((await fetch_boxscore(reader, "g1"))["traditional_players"], [])
            finally:
                await writer.close()
                await reader.close()

        asyncio.run(exercise())

    def test_readiness_fails_when_required_snapshot_migration_is_missing(self):
        self.sql("ALTER FUNCTION public.get_boxscore_snapshot(text) RENAME TO temporarily_missing;")
        try:
            from app.config import Settings
            from app.database import DatabaseClient
            import asyncpg

            async def exercise():
                database = DatabaseClient(Settings(_env_file=None, database_url=f"postgresql://postgres@/postgres?host={self.tmp.name}"))
                try:
                    with self.assertRaises(asyncpg.UndefinedFunctionError):
                        await database.check_readiness()
                finally:
                    await database.close()
            asyncio.run(exercise())
        finally:
            self.sql("ALTER FUNCTION public.temporarily_missing(text) RENAME TO get_boxscore_snapshot;")

    def test_snapshot_read_requires_explicit_function_and_table_privileges(self):
        self.sql(self.publish())
        self.sql("CREATE ROLE snapshot_reader; GRANT USAGE ON SCHEMA public TO snapshot_reader; GRANT SELECT ON public.boxscores, public.boxscore_players TO snapshot_reader;")
        try:
            denied = self.sql("SET ROLE snapshot_reader; SELECT public.get_boxscore_snapshot('g1');", succeeds=False)
            self.assertIn("permission denied for function", denied)
            self.sql("GRANT EXECUTE ON FUNCTION public.get_boxscore_snapshot(text) TO snapshot_reader;")
            value = self.sql("SET ROLE snapshot_reader; SELECT public.get_boxscore_snapshot('g1')->'players'->0->>'points';")
            self.assertEqual(value.splitlines()[-1], "10")
            self.sql("REVOKE SELECT ON public.boxscore_players FROM snapshot_reader;")
            denied = self.sql("SET ROLE snapshot_reader; SELECT public.get_boxscore_snapshot('g1');", succeeds=False)
            self.assertIn("permission denied for table boxscore_players", denied)
        finally:
            self.sql("DROP OWNED BY snapshot_reader; DROP ROLE snapshot_reader;")

    def test_failure_after_parent_update_rolls_back_every_table(self):
        self.sql(self.publish())
        before = self.state()
        error = self.sql(self.publish(score=99, players=[{"game_id": "g1", "player_id": "missing"}]), succeeds=False)
        self.assertIn("foreign key constraint", error)
        self.assertEqual(before, self.state())

    def test_cancelled_snapshot_rolls_back_every_table(self):
        self.sql(self.publish())
        before = self.state()
        self.sql("""
          CREATE FUNCTION public.test_delay_player() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN PERFORM pg_sleep(5); RETURN NEW; END; $$;
          CREATE TRIGGER test_delay BEFORE INSERT ON public.boxscore_players
          FOR EACH ROW EXECUTE FUNCTION public.test_delay_player();
        """)
        try:
            error = self.sql("SET statement_timeout='100ms'; " + self.publish(score=99), succeeds=False)
            self.assertIn("statement timeout", error)
            self.assertEqual(before, self.state())
        finally:
            self.sql("DROP TRIGGER test_delay ON public.boxscore_players; DROP FUNCTION public.test_delay_player();")

    def test_source_observation_survives_publication_and_reads(self):
        observed = "2026-01-15T18:30:00+00:00"
        game = {"game_id": "g1", "observed_at": observed}
        boxscore = {"game_id": "g1", "status": "Final", "observed_at": observed}
        args = ["'" + json.dumps(v) + "'::jsonb" for v in (game, boxscore, [])]
        query = "SELECT public.publish_game_snapshot(" + ",".join(args) + ");"
        for _ in range(2):
            self.sql(query)
            self.assertEqual(self.sql("SELECT observed_at = '2026-01-15T18:30:00Z' FROM games;"), "t")
            self.assertEqual(self.sql("SELECT observed_at = '2026-01-15T18:30:00Z' FROM boxscores;"), "t")
        self.sql(self.publish(game_id="legacy"))
        self.assertEqual(self.sql("SELECT observed_at IS NULL FROM games WHERE game_id='legacy';"), "t")

    def test_mismatched_and_duplicate_ids_rejected(self):
        self.sql(self.publish())
        before = self.state()
        for players in ([{"game_id": "other", "player_id": "p1"}], [{"game_id": "g1", "player_id": "p1"}] * 2):
            self.sql(self.publish(score=99, players=players), succeeds=False)
            self.assertEqual(before, self.state())


if __name__ == "__main__":
    unittest.main(verbosity=2)
