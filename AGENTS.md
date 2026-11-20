# Scio

Personal learning web app ("Your AI Learning Hub"): AI-generated flashcards
and practice quizzes for exam preparation, with SM-2 spaced repetition for
flashcards. Cards and questions are generated through the OpenRouter API with
freely selectable models, or through the owner's Claude or ChatGPT
subscription. Runs as a Docker container in the local network or via
Tailscale. Public repo.

Follows the SG303 baseline v2 (`sgstack/global/AGENTS.md`,
`sgstack/baseline/tools.md`). If you cannot read those: work on a branch,
open a PR, merge only with green checks (squash); never commit secrets or
personal data; English for everything in the repo; talk to me in German.
Keep this file and [docs/architecture.md](docs/architecture.md) current.

**Key constraints:**

- **Single-user project.** No auth, no multi-user features: intended, not
  forgotten. Do not add login or user management.
- The owner is **not a developer**: results must be verifiable by clicking in
  the UI, not through command-line output.
- Every OpenRouter call **costs the owner real money**. Build generation logic
  so that whole generations are not repeated unnecessarily (reuse partial
  results instead of discarding them).

## Tech stack

| Layer | Technology |
|-------|------------|
| Backend | FastAPI (async), SQLAlchemy 2.0 async, aiosqlite, Pydantic v2 (`backend/`, uv) |
| Frontend | React 18, TypeScript, Vite, TanStack Query v5, React Router v6, Tailwind, shadcn/ui (`frontend/`, npm) |
| Data | SQLite at `data/scio.db`, uploads in `uploads/` (both runtime, git-ignored) |
| AI | `backend/app/services/openrouter_client.py` routes every call (OpenRouter, Claude CLI, ChatGPT plan) |
| Deployment | Docker (multi-stage image), Docker Compose, GitHub Actions → ghcr.io |

Backend: endpoints in `app/routers/`, business and AI logic in
`app/services/`, Pydantic schemas in `app/schemas/`, idempotent migrations in
`app/migrations/` (run at startup from the `main.py` lifespan). Frontend:
pages in `src/pages/`, all fetch calls in `src/services/api.ts`, query keys
and shared constants in `src/lib/constants.ts`, generated shadcn code in
`src/components/ui/`.

## Commands

- Setup: `cd backend && uv sync` · `cd frontend && npm ci` · `cp env.example backend/.env`
  (`OPENROUTER_API_KEY` is only needed for AI generation)
- Run backend: `cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
  (without `DATABASE_PATH` in `.env` the DB is `backend/data/scio.db`)
- Run frontend: `cd frontend && npm run dev` (port 3000, API proxy in `vite.config.ts`)
- Docker (the owner's production setup): `cp docker-compose.yml.template docker-compose.yml`,
  then `docker compose build && docker compose up -d` (port 8001 → 8000,
  health check `/api/health`)
- Dependencies: backend only with `uv add` / `uv lock`, never pip.

## Definition of done (required before every commit)

| Check | Command |
|-------|---------|
| Backend lint | `cd backend && uv run ruff check && uv run ruff format --check` (`uv run ruff check --fix && uv run ruff format` fixes most findings) |
| Backend tests | `cd backend && uv run pytest` |
| Frontend type check | `cd frontend && npm run typecheck` |
| Frontend lint | `cd frontend && npm run lint` (existing warnings are known, see `eslint.config.js`, and do not block) |
| Frontend tests | `cd frontend && npm test` |
| Release metadata | `python3 scripts/release.py check` and `python3 -m unittest discover -s scripts -p 'test_*.py'` |
| Docker build | `docker build .` (only for Dockerfile/Compose changes; before releases also `cd frontend && npm run build`) |

**Never commit while one of these checks is red.** In addition, the owner
checks every finished work package by using the app: deliver a one-line,
non-technical test instruction with every change ("Study 5 cards → after a
reload the resume prompt appears").

## Database and migrations

1. SQLAlchemy `create_all` runs at startup (`init_db`) and creates missing
   tables. Hand-written migrations are only needed for **new columns on
   existing tables**; when the ORM gets new columns, always add the matching
   migration.
2. Migrations must be **idempotent** (`PRAGMA table_info` check before
   `ALTER TABLE`, "if table exists" check before `CREATE TABLE`). They run on
   every startup; an error blocks the whole app start.
3. SQLite has `PRAGMA foreign_keys` **off**, so dangling FKs happen silently.
   When deleting referenced rows (e.g. AI models), check the referencing
   objects explicitly.
4. Existing user databases are sacred: never "simplify" migrations with
   `DROP`/`RENAME` on data tables.

## Conventions

- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`,
  `test:`, `chore:`). One commit = one logical change; do not mix refactoring
  and features.
- Backend: timestamps always timezone-aware via `utc_now()`; `logging`, never
  `print()`; aggregation queries (`select(func.count())`, `GROUP BY`) instead
  of loading objects, no N+1 loops over `db.execute`; request/response models
  as Pydantic schemas in `app/schemas/`, never inline; AI generation logic in
  `app/services/`, never in routers.
- Frontend: server state only through TanStack Query; after mutations,
  invalidate every affected query key; every mutation needs visible error
  handling (no silent `catch`). New UI uses the semantic tokens in
  `src/index.css`, the shared components in `src/components/` (PageHeader,
  List/RowActions, EmptyState, OptionCard …) and the colours from
  `lib/studyColors.ts`. UI text is English.

## Hard rules

Never break these; the reasons are in
[docs/architecture.md](docs/architecture.md).

- Do not add auth/multi-user, add dependencies without need, edit
  `components/ui/` by hand, change SM-2 constants without new tests, or move
  to another database system.
- **Answer keys:** discard invalid `correct_answer` indices with
  `logger.warning`; never clamp them (`max(0, min(...))`). A clamped key
  teaches a wrong answer as correct.
- **AI responses:** every call goes through `openrouter_client.py` with
  `response_format: json_object`. Repair regexes run only after a failed
  `json.loads` and only inside `"choices": [...]` arrays; never add global
  regex substitutions over the AI response.
- **Generation endpoints:** reads → AI call → persistence in one commit, so no
  write transaction is open during the AI call. A failed generation leaves no
  empty config or deck.
- **Claude subscription:** only through the official Claude Code CLI
  (`claude -p` with all tools off). Scio never reads, stores or forwards
  Claude tokens, and the CLI is not part of the Docker image. Never enable
  tools for `claude -p` without assessing the prompt-injection risk from
  uploaded documents.
- **Secrets:** ChatGPT tokens live only in `chatgpt-credentials.json` next to
  the DB (0600), never in the DB, logs or API responses. The API returns only
  the last 4 characters of the OpenRouter key.
- **Templates** are only copied, never linked; templates never get a
  `subject_id` or `lecture_ids`.
- **Lectures:** images only PNG/JPEG/GIF/WebP, never SVG. The AI formatter
  must discard its result when the set of image URLs changes; keep that
  check. Notes are never deleted implicitly.
- **Chapter splitting:** the AI never sees the whole book, and nothing is
  saved before the owner confirms the preview.
- **Cross-origin writes:** keep the Origin check on API mutations; `*` in
  `ALLOWED_ORIGINS` only enables CORS reads.
- The service worker never caches `/api/**`.
- Exam objectives stay freely deselectable in the wizard; do not force them.

Before you change generation progress, offline study or the PWA, SQLite
settings, menus and subjects, the Claude or ChatGPT subscription, the
OpenRouter key, templates, exam objectives, lectures, chapter splitting or
the cross-origin protection, read the matching section of
[docs/architecture.md](docs/architecture.md).

## Release

- Read [RELEASING.md](RELEASING.md) in full before release work.
- Document relevant changes under `## [Unreleased]` in `CHANGELOG.md`; do not
  bump versions for every change.
- `backend/app/VERSION` is the authoritative version; sync the frontend with
  `python3 scripts/release.py prepare X.Y.Z`. Releases are prepared as
  `chore: release vX.Y.Z` and merged through a PR; pushing a tag triggers
  tests → GHCR image → GitHub release.
- Tag and push only when publication has been requested. Never change
  existing tags or published release artifacts, and never reset user data
  automatically.

## Deviations from baseline

- `tool-canon`: `scripts/` are plain Python scripts without third-party
  dependencies, tested with `unittest` and not covered by the backend's uv
  project or ruff.
