# Live bootstrap and source investigations

The staged, resumable bootstrap is implemented in `workers/bootstrap.js` with
source adapters in `workers/bootstrap-source.js`. The user requested 2026–27 live
data only, superseding the earlier proposal to load the previous season.

## Production changes completed

- Applied `202610250001_boxscore_snapshot_read.sql` semantics to the existing Neon
  production branch, after a temporary-branch rehearsal. Verified stable reads,
  caller privileges, PUBLIC execution revoked, and execution by the app owner.
  The temporary branch was cleaned up. The Neon migration helper initially split
  dollar-quoted SQL incorrectly; the equivalent single-quoted SQL function body
  was used for its rehearsal/application. No baseline was run against production.
- The initial inventory found 30 teams and 5,103 player identities, but no game,
  box-score, standings or season-stat rows. Existing data was retained.
- Upserted 30 teams and 530 active directory identities using nba_api 1.11.4.
  Players encountered in current season stats/box scores were inserted as needed
  before dependent rows. Historical identities already present were preserved;
  no historical statistical backfill was run.
- Populated 52 games for 2026–27 (43 played plus nine scheduled today), 30 standings rows, 400 player season-stat rows,
  and a serving snapshot containing 30 team-stat rows.
- Populated 15 recent box scores with 523 player lines, using the transactional
  snapshot publisher. The game inventory spans October 20–26, 2026. No other
  season's game rows were imported. Final reference identity count was 5,184.
- Updated only season/history settings in local `workers/worker.env` and
  `frontend/.env` to 2026–27/no historical work; credentials were preserved.

The core bootstrap returned `complete: true`. Five failed checkpoints from earlier
optional leaderboard attempts remain visible as evidence of the unavailable
upstream enrichment, which is no longer part of the default live-data run.

## Source-access evidence

Using the pinned nba_api version locally, game lists, player/team season stats,
standings, the stats V3 scoreboard, and traditional/summary V3 box scores were
reachable. The CDN live scoreboard/box-score responses could not be parsed as
JSON. The implementation therefore uses the working modern stats endpoints.

The `leagueleaders` source continued returning HTML, including after adding the
required Scope parameter documented by nba_api. The default pipeline excludes
that optional enrichment; `--include-leaders` retains explicit failure reporting.
No synthetic/derived official rankings were inserted.

These local checks do not establish access from a cloud network. GitHub-hosted
runner verification is recorded below. [nba_api request guidance](https://github.com/swar/nba_api/blob/master/docs/nba_api/stats/examples.md)

## GitHub Actions verification

The implementation was committed and pushed to `adam` (`b92f50d`, with source
diagnostics added in `0e46274` and `4fa491a`). Manual runs bypass the time gate;
the `refresh` boolean forces publication attempts despite recent checkpoints.
The `probe_only` boolean performs read-only source checks without database writes.

- [Forced refresh run](https://github.com/adamsolimancs/shai/actions/runs/40267945509)
  reached the correct production Neon branch, published 30 static teams and 530
  active directory identities, then failed every requested network-backed stage.
  Games, scoreboard, standings, player/team stats and all seven due recent
  box-score requests timed out after ten seconds. The separate source probe also
  failed. Static directory success is not evidence of live NBA HTTP access.
- [Resume/CDN verification run](https://github.com/adamsolimancs/shai/actions/runs/40268166280)
  retried the failed stages and tested nba_api's separate live CDN clients.
  It also failed: both live scoreboard and box score returned responses that
  nba_api could not parse as JSON (`Expecting value: line 1 column 1`).
- [Read-only longer-timeout probe](https://github.com/adamsolimancs/shai/actions/runs/40268413092)
  also failed. Both live CDN sources again returned non-JSON responses; the
  stats scoreboard request timed out after 60 seconds (60,193 ms measured).
  The worker step was skipped and this probe did not modify the database.

After the write attempts, counts remained 30 teams, 5,184 player identities,
52 games, 15 box scores, 523 player lines, 30 standings rows and 400 player-stat
rows. Game observations remained at `2026-10-26T04:01:07.945Z` and box-score
observations at `2026-10-26T03:52:52.773Z`, from the earlier successful local
import. Failed requests did not advance those observations or replace good data.
Actual local API HTTP requests against Neon still returned 200 for games,
standings, player/team stats and a recent box score, with NBA fetching disabled.

GitHub-hosted NBA access blocked that deployment, while the database and
checkpoints worked. The nba_api maintainers document that stats.nba.com often
does not respond to cloud-hosting IP ranges. More worker concurrency will not
fix this and can add request pressure. The user subsequently chose the Mac as
the ingestion host; the native service deployment is recorded below.
[nba_api hosting guidance](https://github.com/swar/nba_api#rate-limits-and-hosting)

## Recheck after Actions secret cleanup

Repository `NBA_SEASON` was updated to `2026-27`; obsolete `SUPABASE_URL`,
`SUPABASE_SECRET_KEY`, `SUPABASE_SCHEMA` and unused `NODE_ENV` entries were removed.
The functional Neon/Redis settings were retained. Neither Preview nor Production
has environment secrets/variables overriding these values. The modern bootstrap
already pins 2026–27, so the stale season secret was not its source of NBA failures.

[Forced refresh #5995](https://github.com/adamsolimancs/shai/actions/runs/40360888856)
still failed after the cleanup: static directory writes to Neon succeeded, but
all network-backed stats stages timed out, including a separate 60-second probe.
[Read-only network run #5996](https://github.com/adamsolimancs/shai/actions/runs/40362405021)
then compared the public NBA endpoints without database or Redis credentials:

| Probe | This Mac | GitHub-hosted runner |
| --- | --- | --- |
| Stats DNS/TCP/TLS | Successful; certificate verified | Successful; TLS completed in 0.096 seconds; certificate verified |
| Stats HTTP scoreboard | HTTP 200 JSON in 0.200 seconds | Zero response bytes; curl timed out after 20 seconds and nba_api after 60 seconds |
| Live CDN scoreboard | HTTP 403 HTML, Access Denied | HTTP 403 HTML, Access Denied |
| Proxy environment | None configured | None configured |

The Mac also received HTTP 200 JSON in 0.314 seconds from **the exact NBA server
IP used by Actions**, `23.32.109.87`, with the normal hostname and certificate
verification retained. This rules out that endpoint simply being down or the
failure being just a bad DNS destination. It strongly supports network-dependent
NBA edge filtering, such as runner source-IP/reputation rules. The exact internal
NBA rule cannot be established without NBA's server logs; client fingerprint
rules are another possible factor. There was no certificate, DNS, Neon auth,
season-validation or JSON parsing failure on the failing stats request: the
request stalled waiting for its HTTP response. The CDN parser errors are instead
explained by its explicit HTML 403 response, which also occurs on the Mac.

### Why the old green runs are different

[Run #215](https://github.com/adamsolimancs/shai/actions/runs/20701002953) on
January 4 was successful, at commit `cc047c157a51ea5418a4c95c06d4c813baa00dba`.
That worker called the configured backend `NBA_API_BASE_URL` with `NBA_API_KEY`
using `/v1/...` routes. It did **not** make today's direct stats.nba.com requests
from the Actions network. Its `runCronTask` also caught individual failures and
continued without failing the final cron process. Historical green status is
therefore evidence of a completed job, not proof of fresh NBA data from every
stage. GitHub now returns HTTP 410 for those old logs, so exact historical data
coverage cannot be recovered from them.
[Old API request path](https://github.com/adamsolimancs/shai/blob/cc047c157a51ea5418a4c95c06d4c813baa00dba/workers/worker-live.js#L177),
[old task failure handling](https://github.com/adamsolimancs/shai/blob/cc047c157a51ea5418a4c95c06d4c813baa00dba/workers/worker-live.js#L1047).

The workflow was disabled again after the experiment. The Mac worker then ran
successfully to refresh data and restore the failed test's checkpoints. The new
read-only network diagnostic and offline tests are committed/pushed separately;
the pending health-report/native-service source changes remain local.

## Mac ingestion service

The user selected this Mac while awake and online. A private Python 3.11.16
environment with nba_api 1.11.4 passed all core stats source checks. A native
LaunchAgent, `com.shai.ingestion`, is installed for user 501. It uses a separate
runtime copy of worker commit `de65cd2137c3714c3192270bd45b257ac7dd6d0d` plus
the tested launcher (SHA-256 begins `a8c8e042b6c4`); development edits are excluded.
Credentials live in a private ignored environment file, not the plist or release.

The initial ingestion pass returned `complete: true`: games, scoreboard,
standings, player/team stats and seven due recent box scores all succeeded.
The LaunchAgent then independently published fresh game and scoreboard data and
exited 0. Its stderr log was empty. Game and scoreboard successful checkpoints
advanced to `2026-10-26T04:35:47.211Z` and `2026-10-26T04:35:48.227Z` respectively;
the representative box score `0022600118` advanced to `04:34:31.403Z`.

The next real calendar event at 00:40 Eastern also ran without a manual trigger.
Launchd reported two completed service runs with last exit code 0 and no stderr;
the game and scoreboard successful checkpoints advanced again to
`2026-10-26T04:40:04.016Z` and `2026-10-26T04:40:05.111Z`. Both service runs
returned `complete: true`. This verifies native scheduling as well as startup.

The native service checks the New York schedule every five minutes, uses the
shared Redis lease, and caps a run at 20 minutes. Sleep, logout, shutdown or loss
of network access interrupts updates. Later on October 26, the Mac service was
disabled and unloaded at the user's request while Render was investigated.
Recurring GitHub ingestion also remained disabled. The plist, private files,
pinned release and checkpoints were retained. See the [pause and Render investigation](workers/HOSTED_BACKEND_QUALIFICATION.md#current-mac-worker-state)
and [self-hosted runbook](workers/SELF_HOSTED.md#resuming-the-paused-macos-service).

## Validation completed

- 59 worker tests passed, including a regression requiring scoreboard availability
  for a successful source check. Worker tests and the empty-database integration
  were rerun after the dispatch/source-check changes.
- The generated Mac plist passed `plutil`. The manual pinned-runtime run and the
  installed LaunchAgent both read from the NBA source and published to Neon.
- The initial health report returned `healthy` against Neon during those runs.
  That result predates the pause and the final-score reconciliation check. It
  records the presence of player lines at the time, with no evidence about
  missing individual lines.
- Empty disposable PostgreSQL integration passed: dependency order, atomic
  publication/checkpoint rollback, interruption/retry/resume, idempotence,
  optional leaderboard replacement, and current-season isolation.
- The existing disposable Redis lease integration passed.
- All 65 frontend unit tests passed after the season/status changes; 50 desktop/mobile fixture journeys passed, including an explicitly live game after midnight.
- Backend Ruff, Black, strict mypy, and 168 tests passed (one optional integration test skipped); 12 disposable PostgreSQL tests passed.
- Production Next.js build passed.
- Local FastAPI HTTP requests against the seeded live database returned 200 for
  games, standings, player stats, team stats and a recent box score, with direct
  NBA fetching disabled. Readiness's actual database probe passed.

## Score/status correctness

The backend now reads scores and the published box-score status in one SQL
statement snapshot. This avoids losing Final/live status when serving games from
PostgreSQL. Explicit non-final states take precedence over the frontend's
date-based fallback after midnight, and the default score cards render the status
label. These changes were checked with component, browser and actual-database API
tests. These source changes are pushed to `adam` and await application deployment.

## Running and scheduling

See `workers/README.md` for commands and checkpoint windows. The tracked ingestion
workflow invokes the focused runner every five minutes in the evening/late
night and every three hours otherwise, without historical sweeps. Those edits
are pushed to `adam`, and the manual production verification runs are linked
above. The default branch `main` was outside those verification runs. Production
ingestion remains paused. The installed Mac runtime uses its pinned release
independently of edits or merges to this repository. See the [provider decision](workers/PRODUCTION_OPTIONS.md)
and [API-NBA live evaluation](workers/API_NBA_LIVE_EVALUATION.md) before choosing
a replacement source.

Keep direct NBA fetching disabled in the production API. An unavailable source
should delay ingestion and leave honest stale/unavailable UI states, rather than
turning visitor requests into upstream traffic.

The [read-only health report](workers/README.md#read-only-health-and-coverage-report)
can run while ingestion is paused. It distinguishes persisted source observations
from publication times and flags final box scores whose player points disagree
with either team's stored score. The bootstrap also rejects newly fetched final
box scores with that discrepancy before replacing a published snapshot. Run
the source check on the intended host again before reactivating a writer.

On November 14, the Mac passed the read-only source check with 183 game rows,
467 player-stat rows, a five-game scoreboard and a reconciled 24-player final
box score for `0022600042`. The database configured for local ShAI reported
degraded ingestion. Its newest stored game and box-score observations both dated
to `2026-10-26T16:50:24.930Z`. The Mac service remained disabled and unloaded.
