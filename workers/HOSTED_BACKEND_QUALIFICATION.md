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
