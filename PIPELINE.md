# Live bootstrap status — 2026-10-26

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

GitHub-hosted NBA access is currently an operational blocker, not a database or
checkpoint failure. The nba_api maintainers document that stats.nba.com often
does not respond to cloud-hosting IP ranges. More worker concurrency will not
fix this and can add request pressure. Before enabling the new recurring runner,
use an ingestion host with confirmed upstream access or a supported data feed.
[nba_api hosting guidance](https://github.com/swar/nba_api#rate-limits-and-hosting)

## Validation completed

- 59 worker tests passed, including a regression requiring scoreboard availability
  for a successful source check. Worker tests and the empty-database integration
  were rerun after the dispatch/source-check changes.
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
above. The default branch is `main`; it has not been updated, so existing
production scheduling still uses its previous runner. No application deployment
was performed. Automatic live updates have not been verified working.

Keep direct NBA fetching disabled in the production API. An unavailable source
should delay ingestion and leave honest stale/unavailable UI states, rather than
turning visitor requests into upstream traffic.

The next required step is a source/host decision based on the failed cloud probes,
then publication to `main` and observation of repeated successful scheduled runs.
Source/coverage monitoring, broader historical enrichment, raw-response archiving
and more frequent active-game polling remain separate work.
