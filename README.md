# CloudNest

CloudNest is an AI-powered multi-cloud storage workspace that unifies Google Drive, OneDrive,
and Dropbox behind one index. Files are uploaded through CloudNest, hashed for duplicate
detection, classified into a category by an AI service, filed into a matching folder on the
chosen provider, and indexed with real metadata in MongoDB — the actual bytes always live with
the provider, never in the database.

## What works

- Real OAuth 2.0 against Google Drive, Microsoft Graph (OneDrive), and Dropbox, behind a shared
  `CloudProvider` abstraction (`artifacts/api-server/src/providers`) — connect, list, search,
  upload, download, delete, rename, move, create folder, and read live storage quota
- Real multipart file upload: SHA-256 duplicate check → text extraction → AI categorization
  (Gemini, with a deterministic filename-keyword fallback) → find-or-create category folder →
  upload to the real provider → MongoDB metadata → activity log
- Real file management beyond upload: rename (cloud + metadata), move between category folders
  on the same provider, and provider-to-provider migration (copies the file to a new provider
  without ever deleting the original — user confirmation required)
- Simple, explainable storage allocation across connected providers based on real, live quota
  (no fake numbers, no `Number.MAX_SAFE_INTEGER`) — used automatically at upload time when no
  provider is chosen, and available as a standalone recommendation for existing files
  (`/allocation`) that never moves anything without explicit confirmation
- Duplicate detection and grouping, sharing with optional password/expiry/revocation/access count,
  cross-provider search with relevance ordering and size filtering, list/grid file views,
  analytics, and an activity audit trail — all backed by MongoDB
- BullMQ workers (optional, degrade gracefully without Redis) doing real reconciliation:
  re-categorization, duplicate recompute, and provider quota sync
- JWT auth in an httpOnly cookie, bcrypt password hashing, real profile editing and password
  change, rate limiting on auth and share password verification, server-side single-use OAuth
  state, and encrypted provider tokens at rest

## Stack

React + Vite + Tailwind (frontend), Express 5 + TypeScript (API), MongoDB + Mongoose (database),
FastAPI + Gemini (AI categorization), Redis + BullMQ (background jobs), Docker Compose.

## Local setup

Prerequisites: Node.js 22+, pnpm 9+, Python 3.11+, a MongoDB Atlas connection string, and
optionally Docker Desktop.

```bash
cp .env.example .env   # fill in MONGODB_URI at minimum; add provider/Gemini keys as you get them
pnpm install
pnpm --filter @workspace/api-server run dev
```

In a second terminal:

```bash
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/cloudnest run dev
```

For the AI service:

```bash
cd ai-service
python -m venv .venv
source .venv/bin/activate   # .venv\Scripts\Activate.ps1 on Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Open `http://localhost:5173`. The API health endpoint is `http://localhost:5000/api/healthz`.
Without `MONGODB_URI` set, every database-backed route returns `503` rather than crashing.
Without a given provider's OAuth credentials, that provider shows as "not configured" and is
never marked connected.

## Configuration

All variables are listed in `.env.example`: `MONGODB_URI`, `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`
(encrypts stored provider OAuth tokens), `GEMINI_API_KEY`, the Google/Microsoft/Dropbox OAuth
credentials, `REDIS_URL`, and the frontend/backend URLs. Never commit `.env`.

Note on the Dropbox redirect URI: this app's OAuth callback route lives at
`/api/providers/dropbox/callback` (matching Google and Microsoft's pattern), but if your Dropbox
app was already registered with `http://localhost:5000/auth/dropbox/callback`, that's fine —
`app.ts` forwards that exact path into the real handler, so no Dropbox console change is needed.
Just set `DROPBOX_REDIRECT_URI` in `.env` to whichever URI is actually registered in your Dropbox
app console.

## Docker

```bash
cp .env.example .env
docker compose up --build
```

Services: `frontend` (5173), `backend` (5000), `ai-service` (8000), `redis` (6379). MongoDB is
not a Docker service — point `MONGODB_URI` at MongoDB Atlas. The `frontend` and `backend`
Dockerfiles build from the repository root (not their own subfolder) because this is a pnpm
workspace and both depend on packages under `lib/`.

## API surface

`GET /api/healthz`, `GET/PATCH /api/auth/me`, `POST /api/auth/change-password`,
`POST /api/auth/logout`, `GET /api/dashboard`, `GET/POST/DELETE /api/files`,
`POST /api/files/upload` (multipart), `GET /api/files/:id/download`,
`PATCH /api/files/:id/rename`, `POST /api/files/:id/move`, `POST /api/files/:id/migrate`,
`POST /api/folders`, `GET /api/providers`, `GET/POST /api/providers/:provider/connect` (GET
starts the real OAuth redirect), `GET /api/providers/:provider/callback`,
`DELETE /api/providers/:provider/disconnect`, `GET /api/analytics`, `GET /api/activity`,
`GET /api/duplicates`, `POST /api/storage/allocate`, `GET /api/allocation/recommend/:id`,
`GET/POST/DELETE /api/shares`, `GET /api/share/:token`, `POST /api/share/:token/verify`,
`POST /api/share/:token/download`.

## Development checks

```bash
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/cloudnest run build
cd ai-service && pip install -r requirements.txt && pytest
```

## Security notes

Provider OAuth tokens are encrypted at rest (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`) and are never
returned to the frontend. OAuth `state` is a random, single-use, server-side-tracked value, not
the raw user id. Share-link password verification is rate-limited. A provider is only marked
`connected` after a completed OAuth token exchange — never just because credentials are configured.
