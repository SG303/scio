# Scio

> The central reference for every AI agent (Claude Code, Codex, opencode, …)
> working on **Scio**. Read it in full before making changes. Keep it current
> when conventions or start commands change.

Follows the SG303 baseline v1 (`sgstack/global/AGENTS.md`,
`sgstack/baseline/tools.md`). The global rules cover the general way of
working (ask before assuming, simplicity first, surgical changes, verifiable
goals); this file adds the project detail. The global Git and security rules
always apply.

## Project overview

Scio is a **personal learning web app** ("Your AI Learning Hub"): AI-generated
flashcards and practice quizzes for exam preparation, with SM-2 spaced
repetition for flashcards. Cards and questions are generated through the
OpenRouter API with freely selectable models, or through the owner's Claude
subscription (official Claude Code CLI).

**Key constraints:**

- **Single-user project.** No auth, no multi-user features: intended, not
  forgotten. Do not add login or user management. The app runs only in the
  local network or via Tailscale.
- The owner is **not a developer**: results must be verifiable by clicking in
  the UI, not through command-line output.
- Every OpenRouter call **costs the owner real money**. Build generation logic
  so that whole generations are not repeated unnecessarily (reuse partial
  results instead of discarding them).

## Tech stack

| Layer | Technology |
|-------|------------|
| Backend | FastAPI (async), SQLAlchemy 2.0 async, aiosqlite, Pydantic v2 |
| Frontend | React 18, TypeScript, Vite, TanStack Query v5, React Router v6, Tailwind, shadcn/ui |
| Data | SQLite at `data/scio.db` |
| AI | OpenRouter chat completions (`app/services/openrouter.py`, `test_generator.py`, `flashcard_generator.py`) |
| Deployment | Docker (multi-stage image), Docker Compose, GitHub Actions → ghcr.io |

## Codebase structure

```
backend/
  app/
    main.py              # FastAPI app, lifespan (init_db, migrations, model seeding), SPA static serving
    config.py            # pydantic-settings; paths, OPENROUTER_API_KEY (fallback) & CLAUDE_CLI_HOME via .env
    database.py          # async engine + session factory + get_db dependency
    models.py            # SQLAlchemy models (timestamps always timezone-aware via utc_now())
    routers/             # HTTP endpoints: documents, ai_models, tests, flashcards, subjects
    schemas/             # Pydantic request/response models (one module per domain)
    services/            # Business logic: spaced_repetition (SM-2), test_generator,
                         # flashcard_generator, document_parser, openrouter (model cache),
                         # openrouter_client (shared JSON API call with response_format,
                         # routes subscription models to claude_cli), openrouter_key (key from
                         # the settings table or env), claude_cli (Claude Code CLI: install, login, -p),
                         # subject_materials (subject check + dedupe sources),
                         # document_chapters (split books into chapter documents)
    migrations/          # idempotent migration scripts, run at startup (lifespan)
frontend/
  src/
    pages/               # All pages; subfolders flashcards/ and subjects/
    components/ui/       # shadcn/ui generated code: do NOT edit by hand
    components/flashcards/FlashcardStudy.tsx  # Core study UI
    services/api.ts      # All fetch calls (fetchApi wrapper)
    lib/constants.ts     # Shared constants (put query keys here)
    lib/utils.ts         # Helpers (including cost estimation)
  package.json           # Scripts: dev / build / preview / typecheck / lint
backend/pyproject.toml   # Backend dependencies (uv), locked in backend/uv.lock
Dockerfile               # Multi-stage: frontend build → Python image with static files
docker-compose.yml.template
frontend/eslint.config.js  # ESLint rules; shadcn code in src/components/ui/ is exempt from some rules
.github/workflows/       # docker-build.yml, tests.yml (pytest + frontend typecheck/lint on every push/PR)
data/                    # SQLite DB (runtime, git-ignored except .gitkeep)
uploads/                 # Uploaded documents (runtime)
```

## Local development

**Backend** (from `backend/`; dependencies in `pyproject.toml`, locked in
`uv.lock`; add or update them with `uv add` / `uv lock`, never with pip):

```bash
cd backend
uv sync                       # creates backend/.venv with the locked dependencies
cp ../env.example .env        # set OPENROUTER_API_KEY (only needed for AI generation;
                              # all other endpoints work without a key)
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Note: without the Docker `/app/data` directory, the local DB ends up relative
to the working directory in `backend/data/scio.db`. Override with
`DATABASE_PATH` in `.env`.

**Frontend** (from `frontend/`):

```bash
cd frontend
npm install
npm run dev        # Vite dev server (port 3000, API proxy see vite.config.ts)
npm run build      # tsc + vite build → dist/
```

**Docker (the owner's production setup):**

```bash
cp docker-compose.yml.template docker-compose.yml   # set OPENROUTER_API_KEY
docker compose build && docker compose up -d         # port 8001→8000
curl http://<host>:8001/api/health                   # health check
```

## Database and migrations: critical rules

1. SQLAlchemy `create_all` runs at **startup** (`init_db`) and creates missing
   tables with the full ORM schema. Hand-written migrations are only needed
   for **new columns on existing tables**.
2. Migrations in `app/migrations/` must be **idempotent** (always a
   `PRAGMA table_info` check before `ALTER TABLE`, always an "if table exists"
   check before `CREATE TABLE`). They run on every startup in the `main.py`
   lifespan; an error blocks the whole app start.
3. **P5.3 done:** `study_sessions` now has all ORM columns
   (`cards_studied_json`, `new_cards_reviewed_today`, `study_date`), via
   CREATE TABLE and idempotent ALTERs with a PRAGMA check. Lasting rule: when
   the ORM gets new columns, never leave the corresponding migration untouched.
4. SQLite: `PRAGMA foreign_keys` is **off** by default, so dangling FKs happen
   silently. When deleting referenced rows (e.g. AI models), always check the
   referencing objects explicitly.
5. Existing user databases are sacred: never "simplify" migrations with
   `DROP`/`RENAME` on data tables.

## Conventions

**Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`,
`test:`, `chore:`). One commit = one logical change. Do not mix refactoring
and features.

**GitHub language:** everything published to GitHub is in English, including
commit messages, PR titles and descriptions, issues, review comments, release
notes and repository documentation such as `CHANGELOG.md` and `RELEASING.md`.
Translating historical entries must preserve their meaning, versions and
dates; never rewrite tags or published release artifacts. Conversation with
the owner may stay in German.

**Backend:**
- Timestamps **always** timezone-aware (`datetime.now(timezone.utc)`),
  centrally via `utc_now()`.
- No `print()`; use `logging`.
- Prefer **aggregation** queries (`select(func.count())`, `GROUP BY`) over
  materialising objects; no N+1 patterns (avoid loops over `db.execute`).
- Keep request/response models as Pydantic schemas in `app/schemas/`, never
  inline.
- AI generation logic belongs in `app/services/`, never in router files.

**Frontend:**
- `components/ui/` is generated shadcn code: do **not** edit it by hand.
- Server state only through TanStack Query (`useQuery`/`useMutation`). After
  mutations, **invalidate every affected query key** (query keys as constants
  in `lib/constants.ts`).
- Every mutation needs visible error handling (no silent `catch`).
- The app's UI language is **English**; keep new UI text in English.

## Release management (mandatory)

- Read **[RELEASING.md](RELEASING.md) in full** before release work.
- Document relevant changes under `## [Unreleased]` in `CHANGELOG.md`.
  Do not bump versions for every change.
- The authoritative app version is `backend/app/VERSION`; synchronize the
  frontend versions with `python3 scripts/release.py prepare X.Y.Z`.
- Before completing work, run `python3 scripts/release.py check` and
  `python3 -m unittest discover -s scripts -p 'test_*.py'` in addition to the
  existing checks; also run the frontend and Docker builds before releases.
- Prepare releases as `chore: release vX.Y.Z` and merge them into `main`
  through a PR. Explicitly pushing a tag triggers tests → GHCR image → GitHub
  release.
- Tag and push releases only when publication has been requested. Never change
  existing tags. Setting up the process alone does not publish anything.
  See `RELEASING.md` for updates, backups and rollback; never reset user data
  automatically.

## Verification: definition of done (required before every commit)

| Check | Command | Status |
|-------|---------|--------|
| Backend tests | `cd backend && uv run pytest` | Available since P0.2 (`backend/tests/`; the dev dependencies come with `uv sync`). Also runs as a GitHub Actions job on every push/PR |
| Frontend type check | `cd frontend && npm run typecheck` | Available since P0.3 |
| Lint | `cd frontend && npm run lint` | Available since P0.3. Existing warnings are known, planned bugs (see `eslint.config.js`) and do not block |
| Docker build | `docker build .` (only for Dockerfile/Compose changes) | Available |

**Iron rule: never commit while an available check is red.** Since P0.2/P0.3
this applies to `pytest`, `typecheck` and `lint` without exception.

In addition, for every finished work package the owner checks the result **by
using the app** (click test). So deliver a one-line, non-technical test
instruction with every change ("Study 5 cards → after a reload the resume
prompt appears").

## Non-goals and landmines

- **Do not:** add auth/multi-user, add dependencies without need, change
  `components/ui/`, change SM-2 constants without new tests, move to another
  database system.
- **UI overhaul done (PRs #22–#24):** themes and design tokens live in
  `frontend/src/index.css` (`:root` = light, `.dark` = dark). New UI work must
  use the semantic tokens, the shared components in
  `frontend/src/components/` (PageHeader, List/RowActions, EmptyState,
  OptionCard and others) and the card status and rating colours from
  `lib/studyColors.ts`. `components/ui/` stays generated shadcn code and is
  off limits.
- **Landmine 1 (solved, P4.3):** the duplicate `_build_interleaved_queue`
  definition in `spaced_repetition.py` was removed; only the active definition
  exists.
- **Landmine 2 (fixed with P1.1):** `test_generator.py` discards invalid
  `correct_answer` indices (outside `0..len(choices)-1`, not convertible,
  missing) with `logger.warning` instead of silently clamping them to a valid
  index. **Never bring back clamping patterns (`max(0, min(...))`) for answer
  keys or copy them into new code paths**: a clamped key teaches a wrong
  answer as correct.
- **Landmine 3 (fixed with P1.2):** all OpenRouter calls go through
  `app/services/openrouter_client.py` with `response_format: json_object`
  (automatic retry without it if a model does not support it). Repair regexes
  run **only after a failed `json.loads`** and **only inside `"choices": [...]`
  arrays** (`_repair_choices_arrays`). **Never add global regex substitutions
  over the AI response**: they destroy legitimate question and explanation
  content.
- **Landmine 4 (solved, P5.2):** in all generation endpoints (`tests.py`,
  `flashcards.py`, `subjects.py`) the AI call runs **before** the first write,
  so no SQLite write transaction is open during the call. Keep this pattern for
  new generation endpoints: reads → AI call → persistence in one commit, with
  the contract test "a failed generation leaves no empty config/deck".

## Architecture decisions (documented per roadmap)

- **Generation progress (P6.2): polling instead of SSE.** Progress of long AI
  generations uses simple polling (`GET /api/generation/progress/{token}`,
  1.5 s interval) instead of server-sent events. Reason: no WebSocket/SSE
  needed in FastAPI, no proxy configuration for Tailscale, code stays simple.
  Cancel is cooperative: the frontend sets a flag, the generator checks it
  between batches and raises `GenerationCancelled`. An OpenRouter call that is
  already running finishes and its result is discarded. Whoever moves to
  SSE/streams: `generation_progress.py` and `hooks/useGenerationProgress.ts`
  are the only touch points.
- **Offline study (P6.4): localStorage queue.** A deck's study queue is
  mirrored to `localStorage` on load; ratings given offline go into a queue
  (`lib/offlineQueue.ts`) and are replayed **in order** on the `online` event
  (last rating wins, SM-2 order is preserved). HTTP errors while replaying
  (e.g. 404 for a deleted card) are dropped, network errors stay queued. The
  localStorage queue only applies when the device is **online** but the server
  is unreachable (e.g. Tailscale down); when the device itself is offline,
  TanStack Query pauses the rating request and resumes it once the connection
  is back, so the local queue is not used (behaviour unchanged, confirmed by a
  manual test).
- **PWA (P6.4):** manifest and service worker via `vite-plugin-pwa`
  (autoUpdate). `/api/**` is never in the service worker cache
  (`navigateFallbackDenylist`): the API needs the server, offline API calls
  fail into the react-query error paths in a controlled way.
- **SQLite pragmas (round 4):** WAL + `busy_timeout=5000 ms` are set per
  connection via the `connect` event in `database.py`, so the open READ
  transaction during the AI call no longer blocks writes. In-memory test
  engines create their own engines and do not use the app engine event.
- **Menu and subjects (round 5):** four main areas (Dashboard, Subjects,
  Flashcards, Tests), a "New" menu and the gear (`/settings`, tabs AI models |
  AI providers | Test templates). Documents are global and live as a tab under
  Subjects; a subject only remembers default documents (preselection, never
  exclusive). Tests and decks are optionally assigned to a subject
  (`subject_id`) in the normal wizards, later via "Assign subject". With
  `subject_id`, `create-and-generate` deduplicates against the subject's
  existing questions/cards (`subject_materials.py`).
- **Claude subscription (round 6): official CLI instead of tokens.**
  Subscription models have the model ID `claude-subscription/<alias>`
  (opus/sonnet/haiku); `openrouter_client.chat_completion_json` recognises the
  prefix and calls `claude_cli.chat_completion` (`claude -p`, **all tools
  off** via `--tools ""`, prompt over stdin, empty temporary working
  directory, `ANTHROPIC_*` removed from the env). No "provider" DB field, no
  migration. Scio **never** reads, stores or forwards Claude tokens: the web
  login starts `claude auth login`, shows the Anthropic URL and only passes the
  one-time code to the CLI; the CLI manages the tokens itself. Reason:
  Anthropic's terms forbid apps from collecting or brokering Claude
  credentials (tools such as OpenCode/Cline/CLIProxyAPI that used tokens
  themselves were blocked in 2026). The CLI is **not** in the Docker image
  (public repo/image = no redistribution of proprietary software); it is
  installed with one click via the official installer into `CLAUDE_CLI_HOME`
  (`/app/claude`, volume) and updates itself there. Never enable tools for
  `claude -p` without assessing the prompt injection risk from uploaded
  documents.
- **OpenRouter key in the web UI:** the key lives in the settings table
  (`openrouter_api_key`) and takes precedence over `OPENROUTER_API_KEY`; the
  API only returns the last 4 characters. Before saving, `GET /key` checks the
  key with OpenRouter (free).
- **Templates are pure templates:** the wizard only *copies* a template
  (`?template=`), it never links it. `create-and-generate` always writes
  `is_template=False`, `POST /tests/generate/{id}` rejects template IDs and
  templates never get a `subject_id`. Reason: the `TestConfig.tests` cascade
  would delete every test attached to a template when the template is
  deleted. Old tests still attached to a template are shown in the delete
  confirmation via `test_count`.
- **Exam objectives steer the focus:** documents of type `exam_objectives` are
  not study material but the exam's learning objectives. When selected, the
  generators put them into their own prompt section "EXAM OBJECTIVES" with
  the instruction to align questions/cards with them
  (`services/exam_objectives.py`). They stay freely deselectable in the wizard
  (the owner's wish); do not force them automatically.
- **Lecture notes (lectures):** table `lectures` (belongs to one subject,
  Markdown in `content`), router `routers/lectures.py`. Images live under
  `<uploads>/lectures/<id>/<uuid>.<ext>` (only PNG/JPEG/GIF/WebP, **no SVG**
  because of scripts); the Markdown links
  `/api/lectures/{id}/images/{name}`. Deleting a lecture deletes its image
  folder; a subject with lectures cannot be deleted (409), notes are never
  deleted implicitly. Editor: Milkdown Crepe, lazy loaded
  (`components/lectures/MarkdownEditor.tsx`, colours bound to the tokens via
  `markdown-editor.css`). The dock (`LectureDock` in `App.tsx`, state via
  `LectureEditorProvider` in `main.tsx`) survives navigation; minimised, the
  editor stays mounted. Autosave 1.2 s after the last change; every change is
  also written to `localStorage` (`scio-lecture-draft:<id>`) and wins on the
  next open until the server confirms it. Caution: `db_backup.py` only backs
  up the DB, not the images in the uploads volume.
- **Finishing a lecture (AI formatting):** `POST /api/lectures/{id}/format`
  (`services/lecture_formatter.py`) fixes spelling and structures the
  Markdown **without adding or removing content**. The result is saved
  immediately, the previous text goes into `original_content` (comparison
  view with word diff in the dock, "Restore original" via PATCH). One call per
  click; the result is never lost. The server discards the result if the set
  of image URLs changes; this check must not be removed. Before the call the
  frontend saves the notes; the editor is locked during formatting. Columns
  `original_content`/`formatted_at` via the idempotent migration
  `add_lecture_formatting.py`.
- **Lectures as study material:** tests and decks store their source lectures
  in `lecture_ids` (JSON, like `document_ids`; migration
  `add_lecture_sources.py`). `services/lecture_sources.py` turns them into
  document-like objects (`doc_type="lecture_notes"`, image links removed) for
  the generators; all follow-up generations (regenerate deck, add
  questions/cards, new test from config) use the stored `lecture_ids`. A
  missing lecture = 404 before the AI call; when a lecture is deleted, its ID
  is removed from all `lecture_ids`. Templates never get `lecture_ids`
  (lectures belong to a subject). In the wizard, lectures only appear with a
  selected subject; `?lecture=<id>` (together with `?subject=`) preselects
  one.
- **Splitting books into chapters:** on request, a document (usually a large
  PDF) is split into one document per main chapter
  (`services/document_chapters.py`, `POST /api/documents/{id}/chapters/detect`
  → preview, `POST /api/documents/{id}/chapters` → create). Cheap detection
  first: PDF bookmarks, DOCX "Heading 1" or Markdown `#`; the AI only for
  PDFs without bookmarks and only on click. The AI **never sees the whole
  book**, only the first pages (table of contents) and the start of each
  page, and only returns start pages; the server always cuts the text
  (`locate_chapters` corrects printed vs. PDF page numbers). Nothing is saved
  before the owner confirms the preview. Chapters are normal documents with
  `parent_document_id` (+ `page_start`/`page_end` for PDFs; migration
  `add_document_chapters.py`) and inherit the `doc_type`; the book is kept. A
  book is split only once (409), chapters are not split further. Deleting a
  book deletes its chapters (references are cleaned up). The UI groups
  chapters under the book (`lib/documents.ts`, `DocumentPicker`, Documents
  page).
- **Cross-origin write protection:** API mutations reject browser Origins
  other than the request origin or an explicit `ALLOWED_ORIGINS` entry. `*`
  only enables CORS reads, never arbitrary cross-origin writes. Requests
  without Origin remain available to CLI clients unless `Sec-Fetch-Site` is
  `cross-site`. Reverse proxies must preserve the public Host and forward
  `X-Forwarded-Proto`; the Docker image sets `FORWARDED_ALLOW_IPS=*` so
  uvicorn honours it from any peer (uvicorn's default only trusts 127.0.0.1,
  which broke every write behind Traefik); the Vite development proxy
  preserves Host too.

## Deviations from baseline

- `tool-canon`: the backend has no ruff yet; `scripts/` are plain Python
  scripts tested with `unittest` (no third-party dependencies).
