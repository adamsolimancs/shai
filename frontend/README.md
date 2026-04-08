# ShAI Frontend

Next.js App Router UI for ShAI. It consumes the backend API and supports optional NextAuth (Google OAuth).

## Stack
- Next.js 16 (App Router), React 19, TypeScript
- Tailwind CSS
- Vitest + Testing Library
- ESLint

## Architecture
- App Router pages/components fetch data via `frontend/lib/nbaApi.ts`.
- Auth is handled by NextAuth; Google OAuth is optional.

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
NBA_DEFAULT_SEASON=2025-26
AUTH_SECRET=replace-me
```
Optional (for Google OAuth):
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
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
