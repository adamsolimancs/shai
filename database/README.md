# Database reconstruction and migrations

`schema.sql` remains the source of truth for table columns, keys, and indexes. It
is the existing SQL-editor Markdown export, including current local additions.
`build_baseline.py` converts that export to executable SQL, orders referenced keys
before foreign keys, enables RLS, applies API permissions, and includes migrations
in filename order. This avoids maintaining a second copy of table definitions.

For an **empty Supabase database**, generate and review the complete baseline:

```sh
python3 database/build_baseline.py > /tmp/shai-baseline.sql
# Apply /tmp/shai-baseline.sql using your normal database migration process.
```

The output wraps reconstruction in a transaction. Supabase must already provide
`auth.users`, `anon`, `authenticated`, and `service_role`. Do not apply this baseline
to an existing database. Existing databases receive individual unapplied migration
files through the usual migration process; deploy the snapshot migration before
workers that require it. These files describe the intended repository baseline,
not a verified export of deployed permissions, triggers, or functions.

All reconstructed public tables have RLS enabled. Only `service_role` receives
read/write access and a matching policy. Browser `anon` and `authenticated` roles
have no direct table privileges; account access stays behind the backend. Both
search and snapshot RPCs grant execution only to `service_role`. The snapshot RPC
uses invoker permissions and an explicit search path, rather than owner elevation.

`publish_game_snapshot(jsonb, jsonb, jsonb)` writes a game, its boxscore, and its
complete player set atomically. Player rows absent from the new snapshot are
removed, including when the array is empty. Missing optional game properties keep
the previously persisted value; explicit nulls clear it. Boxscores and players are
complete replacements. Existing player/team foreign keys still apply, so reference
data must be ingested first. Same-game publishers serialize on a transaction-scoped
advisory lock. Any failure or cancellation rolls back all writes. There is no
nontransactional publication fallback in the worker.

Run the isolated integration suite (PostgreSQL binaries must be on `PATH`):

```sh
python3 database/tests/test_baseline.py
```

It creates a disposable local cluster using a Unix socket with TCP disabled, supplies
minimal Supabase role/auth stubs, reconstructs from empty, and checks service-role
access, denied browser access, successful/idempotent publication, player replacement,
invalid identifiers, foreign-key rollback, and statement cancellation after game and
boxscore updates. It deliberately accepts no database URL and never contacts deployed
services. This validates PostgreSQL contracts, not Supabase Auth or PostgREST hosting.

The source-observation migration adds nullable `observed_at` columns to games,
boxscores, and API snapshots, and updates atomic game publication to carry them.
No default or backfill uses `now()`: persistence time cannot prove source
freshness. New payloads without observation evidence clear that evidence rather
than attaching an old timestamp to different data. The local integration tests
also verify observation preservation across repeated publication and nulls for
legacy payloads.
