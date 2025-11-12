# ShAI

Modern basketball companion that blends the official NBA Stats data feed with generated insights, player scouting blurbs, and sleek dashboards.

## Features

- Player pages that mix live season averages, recent game logs, and narrative scouting reports.
- Team and league explorers with fast search and caching so common lookups stay snappy.
- Backend service that normalizes data from [`nba_api`](https://github.com/swar/nba_api) and exposes a typed REST interface.
- Optional ML workspace (see `ml/`) for experimentation with win probability, similarity scores, etc.

## Tech Stack

| Layer     | Tech                                                                 |
|-----------|----------------------------------------------------------------------|
| Frontend  | [Next.js 14](https://nextjs.org/) + App Router, Tailwind, TypeScript |
| Backend   | [FastAPI](https://fastapi.tiangolo.com/), Redis cache (optional)     |
| Data      | `nba_api` python client + in-memory/redis caching                    |
| Tooling   | ESLint, Prettier, Jest (Next), Pytest, Docker Compose                |

## Getting Started

### 1. Prerequisites

- Node.js ≥ 20.x and npm (or Bun/Yarn if you prefer, though the repo ships with `package-lock.json`)
- Python ≥ 3.11
- Redis (optional but recommended for caching/rate-limit storage)
- Docker (optional) for running the full stack via `docker-compose`

### 2. Clone & install deps

```bash
git clone git@github.com:adamsolimancs/shai.git shai
cd shai

# frontend deps
cd frontend
npm install

# backend deps
cd ../backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Environment variables

Create the root `.env` or export variables directly. At minimum you need:

```dotenv
# root .env
NBA_API_KEY=replace-me          # used by both FE and BE
NBA_DEFAULT_SEASON=2025-26

# optional overrides
REDIS_URL=redis://localhost:6379/0
NEXTAUTH_SECRET=dev-secret
```

You can also keep service-specific env files in `frontend/.env` and `backend/.env` (examples already exist in the repo). Both services fall back to `NBA_API_KEY` from the root if their local file is missing it.

### 4. Run the stack

#### Frontend (Next.js)

```bash
cd frontend
npm run dev
# http://localhost:3000
```

#### Backend (FastAPI)

```bash
cd backend
uvicorn app.main:app --reload --port 8080
# http://localhost:8080/v1/...
```

#### Docker Compose (optional)

```bash
docker compose up --build
```

This will start the FastAPI service, Redis, and the Next.js dev server in one go.

## Testing

```bash
# backend
cd backend
pytest

# frontend
cd frontend
npm run lint
```

## Project Structure

```
backend/       # FastAPI service wrapping nba_api
frontend/      # Next.js app (App Router)
ml/            # Notebooks + experiments
docker-compose.yml
README.md
```

## Troubleshooting

- **Unexpected server error from NBA API** – ensure `NBA_API_KEY` is valid and that the backend is running (`uvicorn app.main:app ...`). For unsupported seasons the backend returns empty arrays to avoid hard failures.
- **Rate limit errors** – the backend enforces per-key rate limits. Configure `RATE_LIMIT_REQUESTS_PER_MINUTE` in `backend/.env`.
- **Cache misses** – Redis is optional. If it is not running the backend falls back to the in-memory cache automatically.

## License

MIT © ShAI Contributors
