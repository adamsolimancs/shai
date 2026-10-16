# AGENTS.md

Repository-specific instructions for ShAI. Follow them unless the user gives a conflicting instruction.

## OpenAI documentation

- For questions or changes involving OpenAI products, APIs, models, Codex, ChatGPT Work, prompting, agents, or evals, invoke and follow the `$openai-docs` skill.
- Before inspecting repository files or answering from memory, search for the user's exact topic in the official OpenAI documentation and open the relevant page. Use only `developers.openai.com`, `platform.openai.com`, or `learn.chatgpt.com` as documentation sources.
- Preserve any model the user explicitly names. Cite the official page supporting current product behavior, availability, or implementation guidance, and state when the documentation does not establish an answer.

## Project map

- `frontend/`: Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, Vitest.
- `backend/`: FastAPI on Python 3.11, with pytest, Ruff, Black, and mypy.
- `workers/`: Node.js ingestion and cache workers with `node --test` tests.
- `database/`: persisted schema and schema-comparison tooling.
- `ml/`: experimental offline training code; it is not part of the production read path.

## Architecture and data contracts

The production read path is:

`Client -> Backend API -> Redis (hot) -> database (warm fallback) -> NBA API (rare; mostly development)`

- `database/schema.sql` is the source of truth for persisted data shapes. Keep dependent backend models, queries, and worker payloads consistent with it.
- Preserve the cache-first and database-fallback flow unless the task explicitly changes the architecture.
- Treat live NBA API access and optional integration tests as network-dependent. Unit tests must not require live services.

## Implementation conventions

- Match the patterns in the affected subsystem before introducing a new abstraction.
- Handle missing optional data deliberately. In the UI, omit empty or placeholder values rather than displaying them.
- Optimize frontend views for readability. Avoid redundant fields and raw database-shaped output.
- Keep changes within the requested subsystem unless a cross-layer contract requires coordinated updates.

## Validation

Run the smallest checks that cover the changed behavior. Do not run the full repository suite for documentation-only or similarly low-risk edits.

- Frontend: from `frontend/`, run `npm run lint` and `npm run test`; also run `npm run build` for routing, configuration, or production-build changes.
- Backend: from `backend/`, run `ruff check .`, `black --check .`, and `pytest`; run `mypy app` when changing typed interfaces or schemas.
- Workers: from `workers/`, run `npm run test`.
- Cross-layer contract changes: validate every affected subsystem.

Report the checks run and any checks skipped because they require credentials, live services, or unavailable dependencies.
