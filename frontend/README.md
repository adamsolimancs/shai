# ShAI Frontend

Next.js App Router UI for ShAI. It consumes the backend API and supports NextAuth Google OAuth plus optional Supabase-backed email/password accounts.

## Stack
- Next.js 16 (App Router), React 19, TypeScript
- Tailwind CSS
- Vitest + Testing Library
- ESLint

## Architecture
- App Router pages/components fetch data via `frontend/lib/nbaApi.ts`.
- Auth is handled by NextAuth for Google and a Supabase-backed credentials flow for email/password.

## Setup & run
```bash
cd frontend
npm install
cp .env.example .env
```

Create `frontend/.env` from `frontend/.env.example` and set at least:
```
BACKEND_API_BASE_URL=http://localhost:8080
BACKEND_API_KEY=dev-secret-key
AUTH_SECRET=replace-me
```
The frontend derives the current NBA season automatically. Set `NBA_DEFAULT_SEASON`
only when you intentionally want to pin every season-aware view to an override.

Optional (for Google OAuth):
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```
Optional (for Supabase email/password auth):
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=...
```

Run the dev server:
```bash
npm run dev
# http://localhost:3000
```

## Tests & lint
```bash
npm run test
npm run lint
```

## Fixture browser journeys

```bash
npx playwright install chromium
npm run test:e2e
```

The suite runs the real Next development server at `http://127.0.0.1:3100` and a
fixture-only backend at `http://127.0.0.1:18080`. It uses an isolated `.next-e2e`
build directory, a dummy backend key, and no real basketball/auth services. Tests
serialize scenario resets, use hard-refresh cache headers to isolate fixtures,
and reject unconfigured backend routes. External images are stubbed.

Desktop (1440×1000) and mobile (390×844) journeys cover search → player/team and
scores → box score, with fresh, empty, partial, stale, unknown-time, and failed
responses plus search recovery. They assert rendered identity, navigation, empty
versus unavailable states, observation times, missing optional content, overflow,
and runtime health. Screenshots/traces are written under `/tmp`, outside source.
CI installs Chromium and runs these journeys as well as component tests/build.

Use `nbaFetchEnvelope` when a view needs provenance and freshness; `nbaFetch` is
an explicit data-only adapter. Composed profiles collect response observations
per request. Stale views label the source observation time in UTC or state that
it is unknown. Scores use the backend's freshness decision without a second
Next fetch cache. Failed score requests do not become empty successful slates.
