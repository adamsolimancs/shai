# ShAI revival review — 2026-09-07

Prioritize trustworthy ingestion and freshness before adding new product features. The current app already has useful player, team, scores, box-score, news, search, and account journeys. Its main reliability risks lie between successful worker execution, persisted snapshots, and what the UI tells users about those snapshots.

## Implemented

Preserved HTTP exception headers in `backend/app/main.py`. The rate limiter already supplies `Retry-After`, but the application's JSON error handler discarded it. A new HTTP regression test in `backend/tests/test_http_errors.py` exercises the real application's authentication/rate-limit dependency chain with isolated dependencies: it failed on the missing header before the fix and passed afterward. Error status and JSON envelope remain covered. This is a small, reversible fix with no infrastructure or authentication-policy change.

Fixed Next.js page prop contracts in the player index, player detail/metadata, team index, and team detail pages. The production build exposed synchronous `params` union types incompatible with its generated promise-only contract. The teams index also read asynchronous `searchParams` synchronously; it now awaits them before selecting a season. A focused page-level test verifies the requested supported season and invalid-season fallback in backend requests. These changes preserve presentation and existing data flow, with no dependency upgrade.

The standalone TypeScript check also exposed an assertion indexing the empty argument tuple inferred for an existing search fetch mock. Replaced it with a mock-call matcher that preserves the query-string assertion without tuple indexing; existing search test behavior was retained.

## Recommended work, in order

### Now: make ingestion success meaningful

- `workers/worker-live.js:3745`: `runCronTask` catches ordinary task failures and only logs them. `runCron` starts with `finalStatus = "ok"`, so caught failures can still result in an aggregate successful state and process exit. Track per-task outcomes, preserve independent task execution, and define which failures make the run unsuccessful. Validate with a simulated failed refresh and assert both persisted status and exit behavior.
- `.github/workflows/ingest.yml` schedules every ten minutes, allows an hour of worker runtime, and defines no workflow concurrency group. The worker checks and records run state in separate operations. Add a deliberate concurrency/lease policy and test simultaneous starts before relying on the gate to prevent overlapping work.
- `workers/worker-live.js:3540` expects `publish_game_snapshot`; its definition is absent from the inspected database files. When unavailable, it falls back to separate game, box-score, and player writes. Preserve an executable database baseline including this transaction, grants, and policies, then validate reconstruction in an empty local database and rollback on an interrupted snapshot write. This is a repository reproducibility gap; the deployed database was not inspected.

### Next: make freshness and degraded states visible

- `frontend/lib/nbaApi.ts:121` returns only `body.data`, discarding `meta.source`, `meta.as_of`, and `meta.stale`. `frontend/app/(main)/scores/page.tsx:96` converts request failures into empty arrays. Preserve metadata and distinguish “no games” from “data unavailable”; show an update time when serving stale results.
- Validate what `as_of` actually measures. `backend/app/cache_helpers.py` stamps successful fetch/cache time, while `backend/app/api/routes.py:134` defaults source timestamps to request time. These are not necessarily ingestion timestamps. Carry source observation time from the worker/database rather than presenting request time as evidence that basketball data is current.
- Add fixture-driven browser journeys for search → player/team and scores → box score, covering empty, partial, stale, and failed responses at desktop and mobile sizes. Existing passing component tests do not establish those end-to-end contracts.

### Next: harden availability and production boundaries

- `backend/app/cache_helpers.py:72`: a caller that loses the lock waits only 100 ms, then may fetch anyway; lock release precedes cache publication. Locks use a constant value, a two-second lifetime, and unconditional deletion, so a slow owner can delete a successor's lock. Design ownership-safe release and bounded waiting/stale serving, with concurrent slow-fetch and expired-lock tests. This needs more than a mechanical patch.
- `backend/app/main.py:99`: readiness always returns HTTP 200 and tests only a cache read. Define required versus optional dependencies and return an appropriate readiness status when the service cannot serve its essential data.
- `frontend/lib/userAccountsApi.ts:52` and Supabase auth fetches have no explicit application timeout. Add bounded request lifetimes and recovery tests for sign-in/account sync.
- `backend/app/config.py:17` supplies a development API key even in production; rate limiting is keyed to the shared API key in `backend/app/api/routes.py:114`. Add production configuration validation and deliberately separate end-user abuse controls from the shared service budget. Review auth changes separately; this pass did not alter them or establish a deployed vulnerability.

### Later: reduce maintenance cost and expand the product

- Split by behavior once route-level tests protect the boundaries: the worker is 3,942 lines, the NBA service 2,224, and the player page 1,208. Prefer extracting ingestion tasks and presentation/data adapters as they change, rather than a broad rewrite.
- CI currently filters backend, frontend, and worker paths, but database-only changes do not trigger a schema contract job. Add reproducible schema/RPC checks and targeted cross-layer fixtures. Measured backend coverage is 53% overall and 26% in routes; prioritize untested fallback behavior over a blanket percentage target.
- If an assistant is desired, start with a narrow question-to-answer journey using typed tools over these existing cached services and expose source/freshness with each answer. Unstructured retrieval can follow when there are actual document sources. The experimental ML folder is not connected to production; no model, pricing, or vendor recommendation was evaluated here.

## Validation and coverage limits

- Baseline: backend 103 passed / 1 skipped; frontend 32 passed; workers 35 passed. Ruff, Black, and frontend ESLint passed.
- After the fixes: backend 104 passed / 1 skipped; frontend 34 passed; Ruff, Black, frontend ESLint, and standalone `tsc --noEmit` passed. The new HTTP regression was observed failing before implementation. `git diff --check` passed.
- Backend tests ran with the installed Python 3.13.2, not CI's Python 3.11. The opt-in integration test remained disabled. No live NBA, Redis, Supabase, OAuth, migrations, ingestion, deployment, commit, or push was performed.
- Frontend production build: ordinary `npm run build` stalled in Turbopack compilation and was stopped; `npm run build -- --webpack` then exposed the page prop error, and passed after the fixes, including TypeScript and prerendering. This does not establish that the default Turbopack build passes. Build requests used an intentionally unavailable local backend (`127.0.0.1:9`), producing expected caught fetch errors for homepage sections; no real-data rendering was validated.
- No browser/responsive visual inspection was performed: the Browser plugin and repository Playwright installation were unavailable. Page identity, browser console, overlays, screenshots, and interactive mobile/desktop behavior remain unverified. Mypy was not run; backend interfaces were unchanged.
- This was a representative review of entrypoints, configuration, CI, auth/account boundaries, caches, routes, worker orchestration, database exports, and major page data flows, not an exhaustive line-by-line audit. ML training was not validated.

## Existing work preserved

The starting worktree contained 37 modified tracked files plus untracked search service/routes/components/tests, box-score tests, and a search migration directory. They cover search, box scores, cache metadata, documentation, CI, SEO, and test setup. Existing work was preserved. In the already-modified `backend/app/main.py`, this pass only added forwarding of exception headers; in the existing untracked search component test, it only changed the one assertion described above. This pass also changed four previously clean frontend page files and added the HTTP regression test, teams-page test, and this report. Earlier edits are not attributed to this revival.
