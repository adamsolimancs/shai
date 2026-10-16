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
```

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
