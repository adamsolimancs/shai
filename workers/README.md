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

The manual source check also records curl DNS/TCP/TLS/first-byte timings, HTTP
status/content type and a short preview of non-JSON public NBA responses. It uses
normal certificate verification and SDK headers, with curl negotiating supported
compression. For a read-only network comparison on another host:

```sh
workers/.venv/bin/python workers/check-live-sources.py --network-only
workers/.venv/bin/python -m unittest discover -s workers/tests -p test_source_network.py
```

Run these from the repository root. The environment must have nba_api 1.11.4 and
curl installed. Database/Redis credentials are unnecessary and are removed from
the curl child environment. This diagnostic does not use a rotating proxy or
change the ingestion source adapter.

On October 26, 2026, GitHub-hosted stats requests timed out while the same sources
worked locally. The Mac service completed scheduled ingestion and was later
paused during the Render investigation. Both recurring runners are paused. The
[self-hosted runbook](SELF_HOSTED.md) covers a restart on an awake, online Mac,
and the [pipeline notes](../PIPELINE.md) record past verification.

## Read-only health and coverage report

```sh
cd workers
node --env-file=worker.env ingestion-health.js
node --env-file=worker.env ingestion-health.js --json
# With DATABASE_URL already exported:
npm run health
```

The command uses only `DATABASE_URL` and optional `DATABASE_SCHEMA` (default
`public`). It takes a single repeatable-read, read-only PostgreSQL transaction;
it does not acquire the writer lease, update checkpoints, contact NBA/Redis, or
trigger ingestion. Use a database role with SELECT access to the report's tables
if desired. An initialized schema is required; missing tables are an unavailable
report, not an empty database.

Exit codes are **0** for healthy, **1** for degraded or empty, and **2** when a
report cannot be produced (connection, schema, or option error). `--json` emits
one JSON object directly to stdout; use the direct `node` command or
`npm run --silent health -- --json` for automation. JSON `schema_version: 1`
contains `status`, `coverage`, `freshness`, required `stages`, `optional_stages`,
`issues`, and the effective `policy`. Missing timestamps are `null`; gap ID arrays
are empty when no known gaps exist. Issues have stable `code` and `scope` fields.
Unavailable output contains the version, status and a generic error, without
database connection details. An unavailable report has no coverage fields.

The report distinguishes these kinds of evidence:

- **Source freshness:** only persisted `observed_at` values establish when NBA
  data was observed. Games and box scores show oldest/latest observations plus
  stale, missing and future counts. Recent games are evaluated individually, so
  one fresh row cannot hide another stale row. The team-stat snapshot uses its
  observation, never `updated_at`.
- **Publication health:** required bootstrap stages show their latest status,
  attempt, successful checkpoint and committed publication time. A failed or
  running attempt retains its last success but never claims a new publication.
  Static directory success and resumed/skipped work do not establish fresh live
  data. Standings and player-season stats have no persisted source observation;
  their freshness is explicitly unknown even when publication health is good.
- **Coverage:** current-season games, played games, box scores, player lines,
  regular-season player stats, standings and distinct snapshot team IDs are
  counted. Directory counts include retained identities from other seasons.
  The two-calendar-day New York window matches the bootstrap. Missing boxes,
  boxes without player lines, and unfresh boxes for scored games in that window
  affect health. All-season missing box IDs are informational: historical
  backfill is outside this pipeline. Scheduled games with zero scores do not
  require a box score. Player-stat coverage has no invented expected player
  total; standings and team stats expect 30 teams once games have been played.
  Observation ages outside the recent window are informational as well.
- **Final box-score points:** for each recent final with player lines, the
  report sums points by team and compares them with the team scores saved in
  that box score. `coverage.recent.inconsistent_final_boxscores` lists the game
  IDs and reasons when the totals disagree or the saved team scores are invalid.
  The bootstrap applies the same check before replacing a final snapshot. The
  check can find a missing scorer. A missing zero-point player or a non-scoring
  stat error can still pass. Live snapshots are excluded because score and player
  feeds can advance between requests.

Operational limits deliberately allow the current three-hour off-hours schedule:
live observations and required live-stage publications may be at most **six
hours** old; recent final box-score observations/publications may be **24 hours**
old to allow for the six-hour correction interval; static directories may be
**48 hours** old. Timestamps more than five minutes in the future are not fresh.
These are monitoring grace periods, not the worker's fetch/checkpoint TTLs and
not a promise of live scores. The JSON includes these limits.

Required stages are teams, players, games, today's scoreboard, standings,
player stats, team stats, and each known scored recent game's box score. Missing,
failed, running, empty or stale stages degrade health. A deliberate exception
allows empty season-stat publications when fresh successful games and today's
scoreboard checkpoints establish a season with no played games; a zero-game day
alone does not erase season-stat requirements. An initialized empty database
without that evidence reports `empty`. Optional `leaders:*` failures appear
separately and never affect default core health. Older daily scoreboard and
out-of-window box-score checkpoints do not affect it either.

The ingestion workflow appends the human report to its job summary after worker
success or failure. The report step is advisory (`continue-on-error`) and keeps
the original worker failure result. Gated/skipped and probe-only runs do not
read the database for a summary. No workflow run is needed to use this command.

Limits: this is evidence about stored data and bootstrap checkpoints. It cannot
prove NBA reachability, detect games absent from the entire stored inventory,
establish player/standings source freshness, validate every stat, or inspect
Redis/application serving freshness. `healthy` means these documented checks
pass; it is not a claim of complete league data or upstream availability.

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
It also exercises the health reader against empty/partial/complete fixture data,
checks retained source observations and unchanged checkpoints, and runs the real
health CLI for healthy, degraded and empty exit codes. Health unit tests cover
stale/future/unknown observations, failed/running stages, optional failures,
zero-game/off-day states, missing box scores/player lines, invalid snapshots,
and New York calendar boundaries without network services or credentials.

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

## Morning database import

The **Daily hoopR import** GitHub workflow starts at 10:23 a.m. Eastern, after
the observed release time of the NBA standings and player-stat archives. It
uses the same `DATABASE_URL` and Upstash writer lease as the main ingestion
worker. A manual run can require a specific completed slate date.

The morning worker tries NBA Stats with a five-second request timeout and
zero retries. If a fetch fails or the full batch cannot be validated, it
uses hoopR's NBA standings and season-stat archives and ESPN-backed final
scores and traditional box scores. The latest three completed regular-season
slates must reconcile. ESPN games must match one NBA schedule game by date
and home/away teams, and played lines need an unambiguous NBA player ID. A
missing current-season player crosswalk entry can use the previous season
when the ESPN ID and both archived names agree.

The job writes games, box scores, standings and player season stats in a
single database transaction. It retains reconciled stored finals when the
archive agrees or the stored source is newer. Archive standings and player
stats cannot replace rows with more games played. Successful runs read back
the committed rows, invalidate their serving caches, and print a publication
receipt with written and verified counts. The workflow fails if it cannot
verify full publication. If the season-stat archives trail the completed
slate, the job publishes verified scores and boxes, leaves both season
aggregates in place, and exits nonzero with the reason in its receipt.
A receipt is also written to the existing
`ingestion_state` table under `bootstrap:v1` for the season's `morning` entity.

To validate the latest files without writing to a database:

```sh
node workers/morning.js --archive-only --check
```

The isolated hoopR preview importer remains available for Stats Search. It
uses ESPN IDs and can be run locally from CSV with `workers/import-hoopr.py`.

### One-time player season backfill

SportsDataverse's NBA Stats archive includes NBA IDs, regular seasons and
playoffs. The season files currently run from ending year 1997 through 2027.
Generate and inspect the normalized rows before loading a private demo database:

```sh
python3 workers/import-player-seasons.py 1997 2027 > /tmp/shai-player-seasons.json
DATABASE_URL="$DEMO_DATABASE_URL" node workers/publish-player-seasons.js < /tmp/shai-player-seasons.json
```

The publisher inserts missing player identities and season rows in one
transaction, preserves existing rows, and records unknown historical team IDs
as null. It uses the existing `players` and `player_season_stats` tables.
The import leaves unavailable fields such as games started null. This backfill
is run separately from the morning scores workflow. Seasons prior to 1996–97
require an additional source and identifier/coverage validation.

For a local scores preview, create a validated snapshot file and set
`HOOPR_LOCAL_SNAPSHOT_PATH` to its absolute path in `frontend/.env.local` along
with `HOOPR_POC_ENABLED=true`. Next.js uses this file only in development.
A failed import should preserve the previous file. Redirect output to a
temporary file and move it into place only after the command succeeds.
