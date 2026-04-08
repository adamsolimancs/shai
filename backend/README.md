# NBA Data API

FastAPI service that normalizes NBA data and serves it to the frontend with caching, rate limiting, and optional persistence.

## Stack
- Python 3.11, FastAPI, Pydantic Settings
- nba_api + httpx/beautifulsoup4
- Upstash Redis REST cache (optional) and optional database/Supabase store
- Tooling: ruff, black, mypy, pytest

## Architecture (read path)
Client -> API -> Redis (hot) -> DB (warm fallback) -> NBA API (rare; mostly development)

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
Optional (for persistence):
```
DATABASE_URL=...
SUPABASE_URL=...
SUPABASE_KEY=...
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
