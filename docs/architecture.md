# Architecture decisions

Why Scio works the way it does. Read the matching section before you change
one of these areas; the short rules that must never break are in
[AGENTS.md](../AGENTS.md) under "Hard rules". Add new decisions here, not in
AGENTS.md.

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
- **ChatGPT subscription: Sign in with ChatGPT instead of a CLI.** Unlike
  Anthropic, OpenAI officially lets open-source and locally hosted apps use a
  ChatGPT plan (developers.openai.com/siwc), so Scio holds the OAuth tokens
  itself (`services/chatgpt_plan.py`, model IDs `chatgpt-subscription/<slug>`,
  routed in `openrouter_client`). The app registers dynamically on the first
  sign-in (issued client ID in `chatgpt-client.json`). OpenAI only redirects
  to `127.0.0.1` on the browser's computer, so the owner pastes the
  unreachable callback address into Scio. Tokens live in
  `chatgpt-credentials.json` next to the DB (0600, atomic writes), **never in
  the DB** (backups) and never in logs or API responses. Generation uses
  `POST /v1/responses` with `store:false`, `stream:true`, the system prompt as
  a developer message and `json_object` format (retry without it, like
  OpenRouter); no tools, so no prompt-injection execution risk. The plan's
  top three models are seeded once after the first sign-in. OpenAI shares no
  usage numbers; a limit shows as an error pointing to ChatGPT → Usage. This
  does **not** relax the Claude rule above: Claude tokens stay with the CLI.
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

