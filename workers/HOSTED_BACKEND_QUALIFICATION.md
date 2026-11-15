# Hosted backend qualification

The Actions `BACKEND_API_BASE_URL` secret points to
`https://nbai-9ef6.onrender.com`. The API key remains in Actions and is never
included in diagnostic output.

On 2026-10-26, [Actions run 40374638245](https://github.com/adamsolimancs/shai/actions/runs/40374638245)
tested the route from GitHub to the configured backend:

| Request | Result |
| --- | --- |
| `/healthz` | HTTP 200 after 31.7 seconds, consistent with a host cold start |
| Authenticated `/v1/meta` | HTTP 200 in 0.26 seconds; expected NBA service identity |
| Authenticated `/v1/games?season=2026-27&per_team=true&page_size=200` | HTTP 502 after 36.1 seconds |

The current repository's `per_team=true` game route bypasses the database read
branch and calls the NBA client. The probe queries the whole season so it cannot
populate that client's season cache with a date-filtered subset. Success requires
nonempty 2026–27 rows, source `api`, a cache miss, a non-stale response, and an
observation timestamp from the current request. Cached or database success does
not qualify the backend as a functioning ingestion source.

Health and authentication work, but this source request failed. HTTP 502 alone
does not establish the underlying network error or prove that every NBA endpoint
is inaccessible from Render. The public `/openapi.json` confirms the expected
game query parameters and contains no dedicated ingestion, refresh, or source
probe endpoint.

An optional [error-code confirmation run](https://github.com/adamsolimancs/shai/actions/runs/40375037901)
was also dispatched. GitHub reported it queued with no jobs; normal cancellation
reported that it was already completed, while force cancellation reported that
it had not been queued yet. It has no result establishing NBA access. It uses the
same isolated diagnostic job, without database/Redis credentials, if admitted.

The switch condition was not met, so recurring Actions ingestion remains
disabled and the Mac ingestion service is unchanged. The probe job receives no
database or Redis credentials. No production data was published by the failed
source test.

The reusable `backend_probe=true` manual workflow dispatch is committed on
`adam`. Local validation: 114 worker tests passed, including ten hosted-backend
probe tests; workflow YAML and credential isolation checks passed.

## Current Mac worker state

At the user's request on 2026-10-26, the Mac worker was paused with
`launchctl disable gui/501/com.shai.ingestion` and
`launchctl bootout gui/501/com.shai.ingestion`. Verification showed the service
disabled and absent from the launchd domain. The plist, private credentials,
runtime release and ingestion checkpoints were preserved. Do not resume it
automatically during the Render investigation.

## Render investigation and deployed fixes

Render service `srv-d4a64o75r7bs73e7ms80` runs the `prod` branch on a free Oregon
instance. Its initial deployed revision was `c1df59e`. Render logs for the first
Actions test confirm `requests.exceptions.ReadTimeout` from `stats.nba.com`
with a 10-second read timeout; the application ultimately returned `UPSTREAM_ERROR`
and HTTP 502 after three attempts. Health, service authentication and Redis worked.

A controlled local comparison found a separate reproducible client defect:
the backend's obsolete custom headers timed out, while the same query using
`nba_api`'s maintained headers returned data. The backend now imports the maintained
headers, pins the tested `nba_api==1.11.4`, scopes games to the regular season,
includes date ranges in its internal game-cache key, and sends the same six game
parameters used by the worker. Empty optional filters no longer inflate the game
request to 88 parameters. A regression test covers headers, scope, parameter
selection, and separation of full-season and date-filtered cache entries.

These changes were deployed to `prod` as `8cef259` and `38d1c8a`, and preserved
on `adam` as `f704735` and `04cebea`. Existing formatting/import failures in the
older production checkout were also corrected mechanically.

The fixes do **not** restore Render's current NBA access:

- [Post-header-fix Actions test](https://github.com/adamsolimancs/shai/actions/runs/40380499717):
  HTTP 502 with `UPSTREAM_ERROR` after about 36 seconds; Render recorded the same
  10-second NBA read timeout.
- [Final controlled Actions test](https://github.com/adamsolimancs/shai/actions/runs/40381914194):
  the six-parameter request still returned HTTP 502 after a single 60-second
  attempt; Render explicitly recorded `read timeout=60.0`.
- The exact final backend client returned **86 current-season team-game rows**
  from this Mac in **99 ms**, with a cache miss and no out-of-season game IDs.
- A separate Render startup traceback on the same deployed instance shows
  `conn.getresponse()` → `http.client._read_status()` → SSL socket read timing
  out. This places the failure after connection/TLS establishment, waiting for
  the HTTP status line. The independent `CommonAllPlayers` endpoint also timed out.
- No user-configured HTTP/HTTPS/ALL/NBA API proxy variables were present in the
  Render environment settings.

The evidence supports network-dependent NBA edge filtering of Render traffic,
consistent with the [client's hosting guidance](https://github.com/swar/nba_api#rate-limits-and-hosting).
The exact NBA-side rule cannot be established from application logs. It is not
an Actions-to-backend authentication failure or a database ingestion failure.
Longer timeouts, maintained headers and the smaller game query did not solve
the Render-specific failure. There is no successful production source check
justifying an ingestion cutover.

Normal Render upstream settings were restored to `UPSTREAM_TIMEOUT_SECONDS=10`
and `UPSTREAM_RETRY_ATTEMPTS=3` after the controlled test. The Mac worker remains
disabled/unloaded and recurring GitHub ingestion remains disabled. No paid plan,
proxy or new host was provisioned, and no ingestion data was published by these
failed diagnostic jobs.

Validation: current `adam` backend **169 passed, 1 optional integration skipped**;
Ruff, Black and mypy passed. Workers **120 passed**. The isolated production
hotfix backend had **84 passed, 1 optional integration skipped**, with Ruff/Black
passing. Strict mypy still reports **37 pre-existing errors** on the legacy
production backend; the same count was reproduced on its unmodified deployed
revision with the same strict configuration. Those legacy type errors were not
claimed fixed or used to explain the NBA network timeout.
