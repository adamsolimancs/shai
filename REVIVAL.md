# ShAI revival review — 2026-09-14

Ship the PostgreSQL/auth transition as an explicit migration before deploying the current worktree. The application is substantially healthier than the previous revival snapshot: ingestion now has an exclusive renewable lease and aggregate failure state, game snapshots publish transactionally, source-observation metadata reaches the UI, and fixture-driven desktop/mobile journeys cover the primary read paths. The remaining release blocker is operational continuity for the database and existing accounts.

## Instant wins completed in this pass

- Fixed a mobile box-score overflow caused by the global content-reveal animation overriding Tailwind's horizontal `translate` utility. On a 390px viewport, the page expanded to roughly 573px and shifted the main content to the right. The reveal remains as a fade, and the box-score journey now checks page width before navigating away.
- Added league-leader responses to the isolated browser fixture. The new offseason homepage and the players page had begun calling these endpoints, causing one of the recovery journeys to fail the fixture's strict unknown-route assertion.
- Added an explicit offseason-homepage to in-season-toggle journey for desktop and mobile. It verifies the seasonal recap, fixture leader data, the development toggle, route state, and the in-season result.

These changes are small, reversible, limited to shared animation behavior and test coverage, and require no architecture, dependency, schema, or external-system change.

## Current health

- Backend: Ruff, Black, and strict mypy pass. Pytest passes 120 tests with 1 opt-in integration test skipped; measured aggregate coverage is 54%. The locally installed test interpreter is Python 3.13.2 rather than the repository target of Python 3.11. `asyncpg` was supplied only through a temporary `/tmp` target because the host environment had not installed the newly declared dependency.
- Frontend: ESLint passes, all 36 Vitest tests pass, and the production Next.js build passes. The full Playwright suite passes 42 journeys across Chromium desktop (1440×1000) and mobile (390×844), including fresh, empty, partial, stale, unknown-observation-time, and failed states. The Browser plugin was unavailable, so repository Playwright was used.
- Workers: all 48 Node tests pass, including lease ownership/renewal/loss, cron outcome aggregation and exit status, runtime-budget exhaustion, and transactional snapshot requirements.
- Database: all 6 disposable-PostgreSQL reconstruction tests pass, including idempotence and rollback after failure or cancellation.
- `git diff --check` passes. No live NBA, Redis, Neon, OAuth, scheduled ingestion, deployment, commit, or push was performed.

The first sandboxed E2E run exposed the missing league-leader fixture (39 passed, 1 failed). The first sandboxed database run could not allocate SysV shared memory. Turbopack also failed once when its helper process could not bind a sandboxed port. Re-running the affected checks with local-only sandbox exceptions passed; these were environment restrictions, not suppressed failures.

## Prioritized roadmap

### Now — make the database/auth cutover deployable

- Resolved: `202610160001_oauth_account_ids.sql` migrates existing `user_accounts` rows to text OAuth subjects, and the disposable-PostgreSQL suite rehearses it with legacy rows. See `database/README.md` for the account-claiming contract.
- Resolved: `.github/workflows/database.yml` installs `backend/` on Python 3.11 and also runs on `backend/**` changes, so the `DatabaseClient` and account tests in `database/tests/test_baseline.py` run in CI.
- Resolve the box-score read contract. `fetch_boxscore` calls `get_boxscore_snapshot`, but no definition exists in the tracked schema or migrations; every database-backed box-score request can pay for a failed RPC before falling back to separate reads. Either track and test the function or deliberately remove the probe and document the consistency tradeoff.

### Next — harden production boundaries and degraded behavior

- Fail closed on production secrets and readiness. `Settings.api_key` still defaults to `dev-secret-key`, and `/readiness` always returns HTTP 200 after checking only the optional cache. Require an explicit non-development key in production, define which dependencies are essential, and return a non-200 readiness status when the service cannot serve its required data path.
- Bound account-service requests. `frontend/lib/userAccountsApi.ts` has no application timeout, so sign-in synchronization and profile operations can wait on the backend indefinitely. Add an abort deadline and exercise database unavailable, timeout, conflict, and retry behavior through the real NextAuth/profile boundary.
- Make the offseason recap source-authoritative. `fetchFinalsSummary` infers the Finals matchup from the latest repeated June pairing rather than an explicit playoff round or series record. Persist series identity and outcome, or label the UI as inferred, before treating this as a trustworthy historical recap.
- Reduce database amplification on cache misses. Several store helpers load entire dimension tables, and `fetch_player_stats` reads all players, player-info rows, and teams for one leaderboard request. Move joins and limits into typed SQL queries, then measure latency and query counts under cold-cache traffic.

### Later — lower maintenance and operability cost

- Extract modules along tested behavior boundaries as they change. Current hotspots remain `workers/worker-live.js` (about 4,000 lines), `backend/app/services/nba.py` (about 2,200), `backend/app/api/routes.py` (about 1,675), and the player profile page (about 1,220). Avoid a broad rewrite; separate ingestion tasks, route groups, and presentation adapters behind the existing tests.
- Add production-facing telemetry for ingestion age, task failures, stale-cache service, database fallback latency, and lease loss. The worker now records useful per-task outcomes, but those signals still need alerts and a user-visible operational view.
- Clean up provider-specific naming after the cutover is proven. Backend route and store code still uses `SupabaseDep`, `SupabaseClient`, `supabase`, and Supabase-specific log text even though the implementation is generic PostgreSQL; this increases the chance of confusing future migrations and incidents.

## Coverage limits and preserved work

This was a representative pass over entrypoints, setup, CI, configuration, auth/account boundaries, backend storage, cache/freshness handling, database reconstruction, worker orchestration, the offseason homepage, and the primary browser journeys. It was not an exhaustive line-by-line review. The experimental `ml/` pipeline was inspected only for repository placement and was not executed.

The starting worktree already contained a large uncommitted cross-layer change set: 59 tracked-file changes plus 8 untracked files spanning PostgreSQL migration, auth simplification, local Docker setup, ingestion, offseason UI, loading animation, tests, and documentation. All were treated as user work. This pass changed only `frontend/app/globals.css`, `frontend/e2e/backend.mjs`, `frontend/e2e/journeys.spec.ts`, and this report. No unrelated change was reverted.
