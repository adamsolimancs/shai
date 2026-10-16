# ShAI

[![PR CI](https://github.com/adamsolimancs/shai/actions/workflows/ci.yml/badge.svg)](https://github.com/adamsolimancs/shai/actions/workflows/ci.yml)

ShAI is a full-stack NBA data companion that serves player, team, and league views backed by a cached stats API.

## Architecture (read path)
Client -> Backend API -> Redis (hot) -> DB (warm fallback) -> NBA API (rare; mostly development)

`database/schema.sql` is the source of truth for persisted data shapes.

## Tech stack
- Frontend: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS
- Backend: FastAPI (Python 3.11), Pydantic Settings, nba_api, httpx, Redis (optional)
- Workers: Node.js
- ML: pandas + scikit-learn training pipeline in `ml/` (experimental)

## Setup
Root dev prerequisites: Node 20+ and Docker Desktop (or another
Docker-compatible engine with Compose).

From the repository root, start the complete local app with:
```bash
npm install
npm run dev
```
This starts Docker Compose services for the API and Redis, plus the frontend at
http://localhost:3000. The API is available at http://localhost:8080 and reloads
when files under `backend/` change. Docker Desktop (or another Docker-compatible
engine with Compose) is required; on macOS, the command opens Docker Desktop and
waits for it automatically. No host Python virtual environment is needed.
Press Ctrl-C to stop the app, and use `npm run dev:down` to remove its containers.

### Backend API
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"  # or: pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8080
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
# http://localhost:3000
```

## Tests (after significant changes)
```bash
cd frontend && npm run test
cd frontend && npm run lint
cd workers && npm run test
cd backend && pytest
```

## Repository layout
```
backend/   FastAPI service
frontend/  Next.js app
workers/   background jobs / tests
database/  schema.sql (source of truth)
ml/        experimental training pipeline
```
