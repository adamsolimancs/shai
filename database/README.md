# PostgreSQL reconstruction and migrations

`schema.sql` remains the source of truth for table columns, keys, and indexes. It
is the existing SQL-editor Markdown export, including current local additions.
`build_baseline.py` converts that export to executable SQL, orders referenced keys
before foreign keys and includes migrations
in filename order. This avoids maintaining a second copy of table definitions.

For an **empty PostgreSQL database**, generate and review the complete baseline:

```sh
python3 database/build_baseline.py > /tmp/shai-baseline.sql
# Apply /tmp/shai-baseline.sql using your normal database migration process.
```

The output wraps reconstruction in a transaction. Do not apply this baseline to an
existing database. Existing databases receive individual unapplied migration files
through the usual migration process; deploy the snapshot migration before workers
that require it.

The application and worker connect with a private PostgreSQL role. Browser clients
never receive database credentials; account and data access stay behind the backend.

Migrations run unchanged on plain PostgreSQL (including Neon) and Supabase.
Function privileges for Supabase's `anon`, `authenticated` and `service_role`
roles are applied only when those roles exist.

Apply `202610160001_oauth_account_ids.sql` to existing databases before deploying
the direct PostgreSQL adapter. It drops the legacy `auth.users` foreign key,
preserves existing UUID account IDs as text and allows OAuth provider subjects.
Fresh baselines already use text IDs without that key.

Accounts are keyed by `<provider>:<subject>` (for example `google:1234…`). On the
first sign-in with a new subject, a legacy row keyed by a Supabase UUID is re-keyed
to that subject only when the provider reports the email as verified and it matches
the row's email. Rows keyed by another provider subject are never claimed. Sign-in
keeps the saved name and username; profile edits update only an existing account.

`publish_game_snapshot(jsonb, jsonb, jsonb)` writes a game, its boxscore, and its
complete player set atomically. Player rows absent from the new snapshot are
removed, including when the array is empty. Missing optional game properties keep
the previously persisted value; explicit nulls clear it. Boxscores and players are
complete replacements. Existing player/team foreign keys still apply, so reference
data must be ingested first. Same-game publishers serialize on a transaction-scoped
advisory lock. Any failure or cancellation rolls back all writes. There is no
nontransactional publication fallback in the worker.

Run the isolated integration suite (PostgreSQL binaries must be on `PATH`, and
use a Python environment with `backend/` installed, including its dependencies):

```sh
python3 database/tests/test_baseline.py
```

It creates a disposable local cluster using a Unix socket with TCP disabled,
reconstructs from empty, and checks successful/idempotent publication, player replacement,
invalid identifiers, foreign-key rollback, and statement cancellation after game and
boxscore updates, the legacy account-ID migration, and account claiming and
profile persistence. It deliberately accepts no database URL and never contacts deployed
services. This validates PostgreSQL contracts independently of the hosting provider.

The source-observation migration adds nullable `observed_at` columns to games,
boxscores, and API snapshots, and updates atomic game publication to carry them.
No default or backfill uses `now()`: persistence time cannot prove source
freshness. New payloads without observation evidence clear that evidence rather
than attaching an old timestamp to different data. The local integration tests
also verify observation preservation across repeated publication and nulls for
legacy payloads.
