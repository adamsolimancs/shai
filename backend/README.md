# NBA Data API

FastAPI service that normalizes NBA data and serves it to the frontend with caching, rate limiting, and optional persistence.

## Stack
- Python 3.11, FastAPI, Pydantic Settings
- nba_api + httpx/beautifulsoup4
- Upstash Redis REST cache (optional) and Neon PostgreSQL persistence
- Tooling: ruff, black, mypy, pytest

## Architecture (read path)
Client -> API -> Redis (hot) -> DB (warm fallback) -> NBA API (rare; mostly development)

Successful responses include `meta.source`, `meta.as_of`, and `meta.stale` so UI and
tool consumers can reason about provenance and freshness without inspecting payload data.

## Setup & run
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"  # or: pip install -r requirements.txt
cp .env.example .env
```

Create `backend/.env` from `backend/.env.example` (loaded automatically) and set at least:
```
API_KEY=dev-secret-key
UPSTASH_REDIS_REST_URL=https://<your-db>.upstash.io
UPSTASH_REDIS_REST_TOKEN=<your-token>
```
For persistence:
```
DATABASE_URL=postgresql://...-pooler.../neondb?sslmode=verify-full
```
`verify-full` and `verify-ca` keep certificate and hostname verification. When no
root certificate is configured, the API verifies the server against the bundled
`certifi` public CA set. An explicit `sslrootcert` query parameter, `PGSSLROOTCERT`,
a libpq service (`service`/`PGSERVICE`) or an existing `~/.postgresql/root.crt`
takes precedence. Other `sslmode` values are passed through unchanged.

Run the API:
```bash
uvicorn app.main:app --reload --port 8080
# http://localhost:8080/v1/...
```

## Tests & quality
```bash
ruff check .
black --check .
mypy app
pytest
python -m integration.rate_limit_redis  # disposable local Redis; requires redis-server/redis-cli
```

## Production startup, health, and rate limits

Set `BACKEND_ENV=production`, `DATABASE_URL`, and an explicit randomly generated
`API_KEY` with at least 32 characters. The development key and missing database
configuration fail validation before the API starts. Keep the frontend's
`BACKEND_API_KEY` equal to this private service credential. Direct NBA requests
remain disabled by default in production.

Apply `202610250001_boxscore_snapshot_read.sql` **before** deploying this API.
The private application role needs SELECT on the read tables and EXECUTE on
`public.get_boxscore_snapshot(text)`. The function uses caller privileges; it does
not grant access to anonymous/browser roles. If migrations and the app use
different roles, grant EXECUTE explicitly to the app role. Missing functions or
read permissions fail readiness. Do not run an empty-database baseline on an
existing database.

`/healthz` is process liveness. `/readiness` checks the database read schema,
snapshot function, and cache concurrently, with a `READINESS_TIMEOUT_SECONDS`
deadline per dependency (default 2). Production requires a working database read
path and returns 503 when it fails. Redis failure is a 200 `degraded` response
when the database works; startup fallback is labeled `memory_fallback`.
Responses are not cacheable and never expose connection/error details. This is
infrastructure readiness, not a claim that ingestion populated the tables or
that every feed is fresh. Development can run without a configured database.

Redis REST operations have a configurable `CACHE_REDIS_TIMEOUT_SECONDS` timeout
(default 0.5) so an unavailable optional cache cannot consume the entire frontend
deadline. Cache-first stats helpers tolerate read, stampede-lock, fill, and release
errors and continue to the database; existing stale-cache fallback is preserved.

`RATE_LIMIT_REQUESTS_PER_MINUTE` is the per-visitor budget (default 240; the example
env uses 60). `RATE_LIMIT_SERVICE_REQUESTS_PER_MINUTE` is a separate aggregate
budget per service key (default 6000). A rejected visitor does not spend the service
budget. Redis counters/expiry are atomic, namespace-separated, and hashed so raw
service credentials and peer IPs are not stored in counter keys.

Authenticated service callers may supply `x-shai-visitor-id` as a 64-character
lowercase hex digest. The Next frontend derives it from a trusted ingress IP and
replaces caller-supplied identities. Without that header, the API limits the direct
peer; raw forwarded-IP headers are ignored. API keys therefore remain trusted
server credentials, never browser credentials. Visitors sharing a public IP share
a budget. On Redis failure, limits fall back to per-process memory with expiring
entries; this degraded mode cannot enforce a fleet-wide hard cap and resets across
process restarts. Use shared Redis for normal multi-replica enforcement.

## Source observation contract

`meta.as_of` is a nullable source observation time, never the time a request was
served or a DB response was cached. The worker records a conservative UTC time at
the start of a successful upstream game/boxscore fetch and carries it as
`observed_at` into `games`, `boxscores`, and Redis. Re-reading or republishing that
payload does not advance it. This records when the source was observed; it does
**not** establish when the NBA last changed the underlying statistics.

For lists, the oldest constituent observation is used; an unknown constituent
makes the aggregate unknown. Empty database queries, old rows, and payloads without
source observations return `as_of: null`. Snapshots can also carry an explicit
nullable `observed_at` separately from their persistence-only `updated_at`.
Generic cache fills never manufacture an observation. Direct NBA client fetches
retain their actual upstream-fetch observation; cache hits retain that time.

`meta.stale` is true when a stale cache fallback was needed or the known source
observation exceeds the route's freshness budget (its cache TTL). False does not
certify that unknown data is current. Game dates are not observation timestamps;
an offseason schedule is not stale merely because the last game was months ago.
Legacy `:metadata` cache timestamps represented cache fills and are ignored; only
versioned `:observation:v1` metadata or explicit payload observations are used.

Apply `202609070002_source_observations.sql` before deploying these worker/backend
changes. Existing rows deliberately remain unknown until actually observed again;
there is no timestamp backfill to deployment time.
