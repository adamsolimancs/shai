# NBA Data API

Production-ready FastAPI service that wraps selected [`nba_api`](https://github.com/swar/nba_api) endpoints with caching, rate limiting, and analytics-friendly schemas.

## Features
- **FastAPI + Pydantic** on Python 3.11 with `/docs` + `/redoc`.
- **API key auth** via `x-api-key` header (default `dev-secret-key`).
- **Redis caching** with in-process fallback, TTL tiers, and stale-serving on upstream failure.
- **Rate limiting** (default 60 req/min per API key) and structured JSON logs with request IDs.
- **Graceful degradation**: retries + exponential backoff and stale cache responses if NBA Stats is slow.
- **Observability**: `/healthz`, `/readiness`, request logging, configurable CORS, and `/v1/meta`.
- **Background hot-cache refresh** plus fuzzy name resolution powered by `rapidfuzz`.
- **Tooling**: ruff, black, mypy, pytest (coverage ≥90%), Docker + docker-compose, GitHub Actions workflow.

## Getting Started

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env   # adjust values
uvicorn app.main:app --reload --port 8080
```

### Environment Variables
| Key | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port. |
| `API_KEY` | `dev-secret-key` | Shared header secret (`x-api-key`). |
| `REDIS_URL` | `redis://redis:6379/0` | Redis connection string. |
| `CACHE_DEFAULT_TTL_SECONDS` | `7200` | Fallback TTL. |
| `RATE_LIMIT_REQUESTS_PER_MINUTE` | `60` | Per API key burst rate. |
| `LOG_LEVEL` | `INFO` | Log verbosity. |
| `CORS_ALLOW_ORIGINS` | `*` | Comma-separated whitelist. |
| `DATABASE_URL` | `sqlite:///./data.db` | Optional future persistence store. |

### Docker

```bash
docker compose up --build
# API http://localhost:8080, Redis on 6379
```

### Example Requests

```bash
curl -H "x-api-key: dev-secret-key" \
  "http://localhost:8080/v1/players?season=2024-25&search=lebron"

curl -H "x-api-key: dev-secret-key" \
  "http://localhost:8080/v1/players/2544/gamelog?season=2024-25"

curl -H "x-api-key: dev-secret-key" \
  "http://localhost:8080/v1/players/2544/career"
```

See `examples/api.http` for additional scenarios plus a Postman collection blueprint.

## Testing & Quality

```bash
cd backend
ruff check .
black --check .
mypy app
pytest
```

CI (`.github/workflows/ci.yml`) runs lint, type-check, and tests with coverage gates.

## Notes on NBA Stats Terms of Service

This service is designed for **low request volume** analytics workloads, caches aggressively, enforces per-client rate limits, and never redistributes bulk datasets. Please review the latest NBA Stats ToS before deploying publicly; adjust rate limits, cache semantics, and logging as needed for your environment.

## Project Layout

```
backend/
├── app/
│   ├── main.py              # FastAPI entry
│   ├── schemas.py           # Pydantic models + envelopes
│   ├── cache.py             # Redis + in-memory cache
│   ├── rate_limit.py        # Per-key limiter
│   ├── resolvers.py         # Name → ID fuzzy lookup
│   ├── services/nba.py      # nba_api adapter
│   └── ...
├── tests/                   # pytest suite (mocked nba_api)
├── Dockerfile
└── pyproject.toml
```

## TODO / Next Steps
1. Swap API key auth for JWT or OAuth if needed.
2. Add persistence (SQLite/Postgres) for snapshotting nightly aggregates.
3. Expand observability (metrics export, tracing) for production SLOs.
