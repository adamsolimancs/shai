# AGENTS.md

This file captures repo-specific conventions for Codex and other agents. Follow these by default unless the user explicitly overrides them.

## Dataflow pattern (read path)
Client  Backend API  Redis (hot)  DB (warm fallback)  NBA API (very rare; usually only in development)

## Source of truth
- `database/schema.sql` is the source of truth for data models and fields.

## Frontend conventions
- Hide empty or placeholder values.
- Avoid redundant fields across sections.
- Optimize for readability over data density.
- No raw database dumps in UI.

## Quality bar
- Production-ready by default.
- If data is missing, fail quietly and intentionally.
- Match existing patterns before inventing new ones.

## Tests
- Run tests after significant changes to files.
- Commands:
  - `npm run test` (in `frontend/`) — runs frontend tests (vitest).
  - `npm run test` (in `workers/`) — runs worker tests (node --test).
  - `pytest` (in `backend/`)

## Linting & formatting (periodic)
- Frontend lint: `npm run lint` (in `frontend/`).
- Backend lint: `ruff check .` (in `backend/`).
- Backend format: `black .` (in `backend/`) or `black --check .` for non-mutating checks.
