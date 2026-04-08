---
name: nbai-local-dev
description: Use when working in the nbai repository on local setup, runtime debugging, or validation across the backend, frontend, and workers. Covers the repo's startup commands, data-flow assumptions, known local failure modes, and the smallest relevant validation commands.
---

# Nbai Local Dev

Use this skill for repo work that depends on understanding the local startup flow, expected service boundaries, or the validation commands already agreed in `AGENTS.md`.

## Startup

Check these files first unless the task is already narrowly scoped:

- `AGENTS.md`
- `README.md`
- `backend/README.md`
- `frontend/README.md`
- `backend/pyproject.toml`
- `frontend/package.json`

Run services with the repo's expected ports:

```bash
cd backend && uvicorn app.main:app --reload --port 8080
cd frontend && npm run dev
```

Use `GET /healthz` for a quick backend sanity check.

## Architecture

Treat the read path as:

```text
Frontend -> Backend API -> Redis (optional hot cache) -> Supabase/DB (warm fallback) -> live NBA API (last resort)
```

Prefer DB-backed routes when available. The live NBA API is flaky locally and should not be the first choice for current-season data.

## Local Reality

- The repo targets Python 3.11, even if the machine currently has a newer interpreter installed.
- `database/schema.sql` is the source of truth for persisted shapes.
- Empty or partial data should usually fail quietly instead of breaking pages.
- Current-season game data in Supabase may lag behind real time. For local reliability, stale DB data is often better than blocking on `stats.nba.com`.

## Validation

Run the smallest relevant checks after edits:

```bash
cd backend && pytest
cd frontend && npm run test
cd frontend && npm run lint
cd frontend && npm run build
cd workers && npm run test
```

If a task only touches one surface, do not run everything by default.

## Known Traps

- Backend startup can become noisy or slow if background refresh paths force live NBA API requests.
- Frontend build and server rendering are sensitive to slow backend requests on `/scores` and `/teams`.
- If a route already has a DB-backed fallback, prefer preserving responsiveness over forcing a live NBA refresh.
