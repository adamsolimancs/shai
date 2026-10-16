# Ingestion workers

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
