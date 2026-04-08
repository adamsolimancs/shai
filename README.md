# ShAI

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
Prereqs: Node 20+, Python 3.11+. Redis is optional but recommended.

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
