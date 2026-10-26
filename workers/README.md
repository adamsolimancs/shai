# Ingestion workers

## Current live-data bootstrap (2026–27)

`bootstrap.js` is the scheduled/current entrypoint. It imports only 2026–27
regular-season data and a two-calendar-day window of played box scores. It has
no previous-season, career, bio, awards, or historical backfill stages.
`worker-live.js` remains the shared source/normalization library and legacy runner.

From `workers/`, with Node 24+, PostgreSQL initialized from the tracked schema,
and an existing `worker.env` containing the target database and Redis credentials:

```sh
npm ci
# Use an existing Python environment with nba_api==1.11.4 installed.
# PYTHON_BIN=/absolute/path/to/python may be set for a virtual environment.
node --env-file=worker.env bootstrap.js --check-sources
node --env-file=worker.env bootstrap.js --static-only
node --env-file=worker.env bootstrap.js
```

`--check-sources` performs bounded, paced game-list, player-stat, scoreboard and V3
box-score probes without writing to the database. `--static-only` uses nba_api's
bundled directory and performs no NBA HTTP calls. Static seeding upserts exactly
30 distinct teams and active players, preserving existing historical identities
and optional reference fields. Current-season rows and box scores can add a newly
observed player before inserting dependent rows. No history is deleted.

Default stage order:

1. Teams, then active player identities.
2. Current-season games and today's scoreboard, then standings and Base/PerGame
   player and team stats.
3. Played games in the recent window, one box-score checkpoint per game.

Modern `boxscoretraditionalv3` and `boxscoresummaryv3` responses supply box scores.
The source adapters use nba_api through the existing Python bridge. Game IDs,
season/date boundaries, V3 identities, and required fields are validated before
publication. Old-season IDs and incomplete team/score payloads are rejected. Known tipoff times
are retained when a game-list response omits them. Source observations are preserved and
are not advanced when cached/checkpointed data is reused. Static identities do not
claim a live source observation.

State is stored under `ingestion_state.source = 'bootstrap:v1'`. Each entity
includes its season and stage/game. A stage's writes and successful checkpoint
commit together; failed publication rolls back all its writes. Failed/unfinished
steps retry, while successful steps resume within their freshness windows. A valid
empty season-stat response remains `empty`, not completed, and retries later.
A failed independent stage does not suppress recent box-score work. Required
failures make the CLI exit nonzero. No success is inferred from a partially filled
or unavailable source.

Freshness windows: references 24 hours; standings/season stats 15 minutes; game
lists 60 seconds; scoreboard/live box scores 15 seconds; final box scores six hours
(to allow later corrections). `--refresh` bypasses completed checkpoints.
The CLI uses a two-day window; the programmatic runner permits 1–14 days and
always rejects seasons other than 2026–27.

Remote writes require the same renewable Redis lease as scheduled ingestion.
Local tests use isolated PostgreSQL and fixture sources with deployment variables
removed. Cache invalidation follows successful publication, and cache errors do
not turn committed database writes into failures. Shared credentials stay in the
existing environment files and are not logged.

Stats requests are serially paced at 1.5 seconds by default. The bootstrap defaults
to zero immediate retries and a 10-second stats timeout; failures are checkpointed
for the next run instead of monopolizing the writer with long retry loops.
`PYTHON_BIN` selects the interpreter; `STATS_TIMEOUT_MS`, `STATS_RETRY_MAX`, and
`API_MIN_INTERVAL_MS` are explicit overrides.

`--include-leaders` enables optional leaderboard enrichment. It is excluded from
the default live pipeline: that upstream endpoint returned HTML during the source
checks even with its documented required parameters. Explicitly requested
leaderboard failures still produce failed checkpoints/nonzero exit. No derived
statistics are substituted as official rankings.

The tracked GitHub workflow invokes the bootstrap every five minutes during
15:00–03:00 America/New_York and every three hours otherwise. Checkpoints govern
which stages actually fetch. This is periodic refresh, not second-by-second live
streaming. Workflow changes affect production scheduling only after publication.

Manual runs always bypass the clock gate. Set the boolean `refresh` input to
force every stage, or `probe_only` to check NBA access without touching Neon.
Manual diagnostics include nba_api's live CDN scoreboard/box score and a stats
scoreboard probe with a 60-second deadline. Source-check failures fail the run;
successful static directory writes do not imply live data access.

On October 26, 2026, GitHub-hosted stats requests timed out while the same sources
worked locally. The new workflow is pushed to `adam`; recurring runs still use
`main`. See [PIPELINE.md](../PIPELINE.md) for run links and actual database freshness.
Choose an ingestion host with confirmed source access or a supported data feed
before relying on this schedule. Adding workers does not fix source reachability.

## Bootstrap validation

```sh
npm run test
# Requires initdb, pg_ctl and psql on PATH; creates an empty socket-only cluster.
npm run test:bootstrap-integration
npm run test:lease-integration
```

The PostgreSQL test exercises the actual runner/store against an empty database:
reference ordering, no inactive-history insertion, a newly observed player's FK,
source interruption, publication rollback, retry, resume, idempotence, optional
leader replacement, and current-season isolation. It never accepts or inherits a
deployment database URL/cache credentials. PR CI installs PostgreSQL and runs it.

## Legacy runner behavior

The following sections describe direct `worker-live.js` cron/live execution, not
the focused bootstrap entrypoint above.


## Cron outcomes

A cron run is successful only when every due refresh completes. Each scheduled task has an outcome in `ingestion_state.last_cursor.task_outcomes` on the `nba_api` / `cron_budget` row: `ok`, `failed`, `skipped`, or `not_started`. Interval skips and deliberate maintenance-budget skips are neutral. A runtime-budget abort marks the remaining tasks `not_started` with reason `budget_exhausted`.

Ordinary refresh errors and task-state read errors mark that task failed while independent tasks continue. Cron concurrency batches also finish independent items and then throw if any item failed. A runtime-budget error stops further work. Any failed task or runtime-budget exhaustion makes the final cron status `failed`, records the task/error summary in `last_error`, and exits the CLI with code 1 after persisting that state. Successful and gated/skipped runs exit 0. State-write failures also exit nonzero; a failed persistence request cannot guarantee a final database status.

Successful fallback reads remain successful. Optional advanced-boxscore enrichment and serving-cache writes/invalidation still log errors without failing a refresh; persisted primary data remains the success criterion. Live-mode concurrency remains best effort. The season refresh loops already collect failures and throw after processing independent seasons.

`npm run test` includes subprocess simulations that exercise the actual CLI completion handler and ingestion-state serialization with local service fixtures: failed scoreboard refresh, successful and skipped tasks, state-read failure, budget abort, and a failed concurrent item. They assert recorded states and process exit codes without live NBA or database access.

## Cron concurrency

GitHub Actions uses the `production-ingestion` concurrency group with `cancel-in-progress: false`. The worker also requires shared Upstash Redis in cron mode and acquires a lease before reading its scheduling cursor. Every cron writer targeting the same database must use the same Redis instance and `DATABASE_SCHEMA`; the lease key is derived from the database host, database name, and schema without including credentials.

Acquisition uses atomic Redis `SET NX PX` with a 120-second expiry. An owner token is checked by Lua on renewal (every 40 seconds) and release, so a previous owner cannot renew or release a successor's lease. A held lease skips the run. Missing Redis or acquisition errors fail closed. Renewal errors, ownership loss, or a hung renewal exceeding the 108-second watchdog terminate the process with failure. Such abrupt exits can leave ingestion status `running`; the lease expires within 120 seconds of its last successful renewal and a later run can proceed.

The workflow group is the primary serializer for scheduled runs. The Redis lease also coordinates manual starts across processes, with contention, renewal, expiry, successor ownership, and watchdog tests. A TTL lease assumes bounded event-loop pauses; it is not database fencing and cannot revoke writes already dispatched by an old process.

Run `npm run test:lease-integration` with `redis-server` and `redis-cli` installed to verify the actual Redis commands and Lua scripts. This starts an isolated Redis instance on a temporary Unix socket with persistence disabled, tests 20 simultaneous starts, renewal beyond the original expiry, expiry/reacquisition, stale-owner release and ownership loss, then stops Redis and removes its files. It never uses deployment credentials. PR CI installs Redis and runs this check; ordinary `npm run test` remains independent of Redis installation and live services.

Game and boxscore source observations are recorded at upstream fetch time, then
carried unchanged as `observed_at` through mapping, transactional publication, and
Redis. Existing stored rows retain their observation when reused. Cache writes
also publish `:observation:v1` metadata with the same fresh/stale TTLs as the data;
cache writes never use their own write time as an observation. Apply the
`202609070002_source_observations.sql` migration before deploying this worker.
