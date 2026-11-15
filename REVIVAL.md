# ShAI revival and production hardening — 2026-10-25

The current-season bootstrap is implemented and has seeded the live Neon database. The snapshot-reader migration is also applied. See [PIPELINE.md](PIPELINE.md) for production counts, source-access results, local validation, and the remaining publication/monitoring steps. The earlier hardening review below is retained as a record of that pass; its no-live-mutation statements describe the earlier pass only.

## Implemented

- **Consistent box-score reads:** `202610250001_boxscore_snapshot_read.sql` defines `get_boxscore_snapshot(text)` as a single STABLE, SECURITY INVOKER SQL statement returning the parent and ordered players from one MVCC snapshot. Missing data returns NULL; an empty player set returns an empty array. The backend no longer falls back to inconsistent separate reads if the function fails. Existing route behavior still distinguishes absent data, unavailable sources, and stale-cache fallback.
- **Production configuration and readiness:** production requires an explicit API key of at least 32 characters and DATABASE_URL. `/healthz` remains liveness. `/readiness` checks database schema/read privileges, the required snapshot reader, and cache with bounded dependency deadlines; database failure returns 503. Redis can degrade while the database works; startup memory fallback is visible. Responses are not cacheable and do not expose connection errors. This checks infrastructure, not whether ingestion filled the database.
- **Usable database fallback during Redis failure:** cache-first stats helpers tolerate failed reads, metadata reads, fills, and stampede-lock operations. A production API regression verifies that a database box score and its original observation timestamp survive a Redis outage. Redis REST timeout is configurable and defaults to 0.5 seconds.
- **Visitor-aware limits:** frontend server fetches derive an opaque HMAC from a trusted ingress IP. Vercel's visitor header is supported automatically; other ingresses require explicit trusted-header configuration. The frontend replaces caller-supplied visitor IDs. Authenticated backend calls use independent visitor and aggregate service budgets. Raw forwarded IPs do not select backend buckets. Redis increments/expiry are atomic; expired local counters are cleaned up. Search preserves 429 and Retry-After and supports recovery. Direct/background callers use peer/service budgets.
- **Earlier revival fixes preserved:** stats/search and account request deadlines include response bodies; caller abort listeners are cleaned up. Sign-in retains stable identity when account synchronization times out; profile saves show a timeout error without updating the session. No automatic retry was added to ambiguous writes.

## Local validation

| Surface | Result |
| --- | --- |
| Backend | Ruff, Black, and strict mypy passed; pytest: 167 passed, one opt-in integration test skipped. |
| PostgreSQL | 12 disposable-cluster tests passed, including concurrent publication/read consistency, uncommitted writer isolation, missing/empty snapshots, required migration checks, private function/table privileges, rollback/cancellation, and account migration/persistence. |
| Redis | Disposable Redis rate-limit integration passed through the real Upstash adapter command payloads and Lua: concurrent replicas, visitor/service namespaces, expiry, and repair of counters missing TTLs. Added to backend CI. |
| Frontend | ESLint and 63 unit tests passed. Production build and TypeScript passed, including a build with VERCEL=1. |
| Browser | 48 fixture journeys passed in Chromium at desktop 1440×1000 and mobile 390×844. Includes scores/box scores, player/team search, missing/stale/failed data, stalled response bodies, 429/recovery, consistent visitor propagation across server-rendered stats and the search route, and Retry-After preservation. |
| Workers | All 48 Node tests passed. Worker implementation was not changed in this follow-up. The disposable Redis lease integration also passed during the preceding revival pass. |
| Patch | `git diff --check` passed. |

The Browser plugin was unavailable, so the repository Playwright workflow was used at `http://127.0.0.1:3100` with its local fixture backend. Journey assertions cover meaningful page content, identity, navigation, console/runtime errors, framework overlays, and horizontal overflow. Existing desktop search-timeout and mobile box-score screenshot evidence was visually inspected during the revival. External images are stubbed. The browser tests verify the real Next request path against a controlled backend; separate API tests verify actual FastAPI budgets. They are not a live-provider end-to-end test.

Tests initially exposed fixture gaps (the new service limiter dependency and the full meta response shape), which were corrected. Sandboxed socket restrictions required local-only exceptions for the existing TLS tests, browser servers, disposable PostgreSQL/Redis, and Turbopack helpers.

## Rollout requirements

1. Apply `202610250001_boxscore_snapshot_read.sql` before deploying the API. Grant EXECUTE on `public.get_boxscore_snapshot(text)` and SELECT on required tables to the private app role if it differs from the migration owner. PUBLIC execution is revoked; Supabase service_role receives execution only when that role exists. Use the generated baseline only for an empty database.
2. Set BACKEND_ENV=production and matching API_KEY/BACKEND_API_KEY using a generated secret of at least 32 characters. Configure DATABASE_URL. Missing required configuration now prevents startup; a missing migration/permission fails readiness.
3. Keep direct NBA fetching disabled in production. Set visitor and service budgets independently through RATE_LIMIT_REQUESTS_PER_MINUTE and RATE_LIMIT_SERVICE_REQUESTS_PER_MINUTE. The former defaults to 240 (example env uses 60); service capacity defaults to 6000.
4. On Vercel, trusted IP extraction is automatic. Elsewhere, configure TRUSTED_CLIENT_IP_HEADER only behind an ingress that overwrites the header and prevents direct origin access. Without trusted identity, frontend requests share a backend peer budget. People sharing a public IP share the visitor budget. API keys remain trusted server credentials.
5. Use shared Redis for normal multi-replica enforcement. Redis outage fallback is per process, resets on restart, and cannot enforce a hard fleet-wide cap.

No live migrations, live ingestion, deployment, commits, or pushes were performed.

## Prioritized remaining work

### Now

Build and rehearse the staged bootstrap described in PIPELINE.md: seed reference directories, then current/previous-season batch data, then recent box scores and optional enrichment. Verify source access from the actual worker host before filling production. The present cron runs dependent game work before reference rows, and a whole-directory player-info refresh can exceed the hour budget and starve later work.

### Next

Separate live updates from historical/enrichment work with durable per-item progress, bounded retries, upstream request budgets, and coverage/freshness metrics. Make the Finals recap authoritative: `frontend/app/(main)/page.tsx` still infers finalists/champion from June games rather than explicit series completion. Optimize cold-cache leaderboard queries: store helpers load entire dimension tables, while the generic adapter casts filter columns to text. Measure plans/latency before changing those queries.

### Later

Add alerts for ingestion lag, missing datasets, stale service, failed tasks, and lease loss. Extract behavior-bound modules incrementally from the roughly 4,000-line worker, 2,200-line NBA client, and 1,700-line routes file. Avoid a broad rewrite while data coverage is the immediate product bottleneck.

## Limits and preserved work

The worktree already contained eight modified files from the preceding revival; those edits were preserved and extended. No unrelated work was reverted, and generated Next type-path changes were restored after validation.

Local backend tools use Python 3.13.2 rather than CI's 3.11. Host nba_api is 1.10.2, older than the declared/workflow dependency; source-network behavior was not exercised. The missing declared asyncpg dependency was supplied only through a temporary /tmp target. Node is locally 25.9.0 versus CI's 24. No project dependency versions or host installations were changed.

This was a representative architecture/behavior review and local regression pass, not a production security audit, load test, deployed data inventory, live OAuth/NBA test, or dependency vulnerability audit. No deployed database counts or source freshness were inferred from fixture results. The experimental ml pipeline was not run.
