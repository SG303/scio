# Changelog

All notable changes to Scio are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security

- Update backend dependencies with known vulnerabilities: python-multipart
  0.0.33, FastAPI 0.162 (Starlette 1.x), Uvicorn 0.54 and Pydantic 2.14.
- Replace the deprecated, vulnerable PyPDF2 with its maintained successor
  pypdf for PDF parsing and chapter splitting.
- Update the frontend toolchain to Vite 8, Vitest 5, @vitejs/plugin-react 6
  and vite-plugin-pwa 2, and React Router to 6.30.6. This resolves all
  critical and high npm audit findings.
- Update pytest to 9.2 (fixes GHSA-6w46-j5rx-g56g) together with
  pytest-asyncio 1.4, and update SQLAlchemy 2.1, aiosqlite, httpx and
  python-docx. SQLAlchemy is now installed with its `asyncio` extra because
  2.1 no longer pulls in `greenlet` on its own.
- Force patched versions of the build-time dependencies minimatch 11
  (GHSA-g3hv-75wg-m249), KaTeX 0.19 (GHSA-238p-pmpm-9mq7) and, for the PWA
  service worker build, glob 14 through npm overrides.

### Changed

- Build the frontend with Node 24 LTS (Node 20 reached end of life) and
  update the GitHub Actions used by CI and releases to their current major
  versions.
- Let Dependabot propose weekly updates for npm, pip, Docker and GitHub
  Actions dependencies.

## [v0.7.1] - 2026-11-04

### Fixed

- Behind a TLS-terminating reverse proxy (Traefik, nginx, Caddy), API writes
  such as creating a subject failed with "Cross-origin writes are not allowed".
  The Docker image now trusts the proxy's `X-Forwarded-Proto` header by default
  (`FORWARDED_ALLOW_IPS`), so the public `https` origin matches.

## [v0.7.0] - 2026-11-04

### Fixed

- Keep active flashcard queues stable across tab focus and reconnection, and
  reset daily new-card counters when a session crosses midnight UTC.
- Reject invalid answer keys before padding options; preserve single-letter
  choices and answer mappings when recovering malformed AI responses.
- Keep paid partial question results if later generation strategies fail.
- Preserve newer lecture edits when an earlier AI formatting request finishes.
- Clear external flashcard source references when deleting a subject's tests.
- Support Unicode deck titles in CSV and Anki download headers.
- Respect database and upload paths configured through environment or `.env`
  outside Docker.

### Security

- Reject API writes from untrusted browser origins, including form submissions.
  Same-origin LAN/Tailscale access, explicit allowed origins, and CLI requests
  remain supported. The Vite proxy preserves the browser-facing Host header.

### Added

- A consistent release process with synchronized app versions, release tag
  validation, versioned Docker images, and GitHub Releases. Maintainer and
  AI agent instructions are documented in `RELEASING.md`.
- Large books can be split into one document per main chapter, right after
  upload or later from the document's menu, so tests and decks can use just
  the chapters you need. Chapters are found for free from PDF bookmarks or
  Word/Markdown headings; for PDFs without bookmarks an AI model of your
  choice finds them from the table of contents, without reading the whole
  book. You review and adjust the chapters before they are created. The book
  is kept, and its chapters are grouped under it in every document list.

### Upgrade notes

The new chapter columns on documents are added automatically on startup.

### Manual verification

Study several cards, switch to another tab for over five minutes, then return:
the next card should remain correct. Export a deck named “数学 Łódź” as CSV
and Anki. Upload a Markdown book with several top-level headings and use
“Split into chapters” to review and create its chapter documents without AI.

## [v0.6.0] - 2026-11-03

### Added

- A default AI model under Settings → AI models; subjects can override it
  with their own model. “Finish lecture” uses the resolved model directly
  without asking again each time.
- New flashcards can be added to an existing deck in the wizard, including
  cards based on lecture notes. Generation takes existing cards into account;
  new sources remain stored in the deck for future additions.
- Language selection for generated questions, answers, and cards in subjects
  and wizards. “Auto” follows the language of the study material; the selected
  language is saved for future generations.

### Fixed

- Space and Enter flip every flashcard without requiring a click first;
  keys 1–4 continue to rate the answer.
- The Study counter no longer subtracts cards started today twice and shows
  the actual remaining daily allowance.

### Upgrade notes

The new language columns are added automatically on startup.

## [v0.5.0] - 2026-11-03

### Added

- Lecture notes in Subjects: a “Lectures” section with “New lecture”.
  The editor formats Markdown as you type (headings, lists, tables, `/` menu).
  Images can be pasted (Ctrl+V) or dragged and dropped. Notes save automatically,
  remain in the browser during a connection failure, and sync afterward;
  Ctrl+S saves immediately.
- The editor can be minimized to a bar and stays open while navigating Scio.
- “Finish lecture”: AI corrects spelling and structures notes without adding
  or removing content. A comparison view shows every change (“Keep formatted” /
  “Restore original”); the original text remains saved. If AI changes images,
  the result is discarded.
- Flashcards and tests from lectures: lectures appear as selectable sources
  in the wizards, and lecture menus offer “Create flashcards” and “Create test”.
  Later additions (Add cards/questions) reuse the notes.

### Changed

- Selected exam objectives documents now appear in a separate prompt section:
  AI treats them as exam learning objectives, aligns questions and cards with
  them, and does not ask questions about the list itself.

### Upgrade notes

New tables and columns are created automatically on startup.
Images from notes are stored in the `./uploads` volume and are not included
in the automatic database backup.

## [v0.4.0] - 2026-11-03

### Added

- A new “AI providers” tab under Settings to save, replace, and remove the
  OpenRouter API key. The key is validated with OpenRouter before saving and
  takes precedence over the `OPENROUTER_API_KEY` environment variable.
- Claude subscriptions as a second AI provider: install the official
  Claude Code CLI with a click (volume `./claude:/app/claude`) and sign in
  through Anthropic's website. Opus, Sonnet, and Haiku “(subscription)” then
  become available; cost estimates show “Included in your Claude plan”.
- Subscription usage display (five-hour window and weekly usage), with reset
  times and a “Check now” button.

### Fixed

- Test generation no longer stays on “Generating” indefinitely when accessed
  through `http://<IP>` (LAN or Tailscale): `crypto.randomUUID()` is only
  available in secure contexts (HTTPS, localhost).

### Upgrade notes

Add the new `./claude:/app/claude` volume to your `docker-compose.yml`
(see `docker-compose.yml.template`); otherwise, the CLI and sign-in are lost
whenever the container is rebuilt.

## [v0.3.0] - 2026-10-21

### Added

- Subject selection directly in test and deck wizards. The subject's default
  documents are preselected; all others remain selectable. Documents can be
  uploaded in the wizard and are selected automatically afterward.
- “Assign subject” and subject labels in the Tests and Flashcards lists;
  “Your subjects” and “View statistics” on the Dashboard.
- Templates in the test wizard (“Start from template”) and an option to save
  generation settings as a template.

### Changed

- Navigation reduced to four sections (Dashboard, Subjects, Flashcards,
  Tests), with a “New” menu and a settings gear. Documents is a tab under
  Subjects; templates are under Settings.
- When a subject is selected, questions/cards already belonging to it are
  not generated again.
- Templates no longer generate tests directly. Deleting a template asks for
  confirmation and lists affected legacy tests.

### Fixed

- Deleting a test from the subject page always failed.

## [v0.2.1] - 2026-10-21

### Fixed

- Test generation failed in every strategy with “object NoneType can't be
  used in 'await' expression”: the router's progress callback was synchronous,
  but the generator awaited its return value. The callback is now asynchronous,
  with a regression test file covering this behavior.

## [v0.2.0] - 2026-10-21

### Added

- Comprehensive UI redesign (PRs #22–#24): a new minimalist design system
  with complete shadcn tokens for light and dark themes
  (`frontend/src/index.css`, neutral grays, indigo as the only accent).
  The theme follows the system setting by default; the header's Sun/Moon
  toggle saves the choice in localStorage under `scio-theme`, with an inline
  script preventing startup flicker.
- Shared UI components (`PageHeader`, `SectionHeader`,
  `List`/`ListRow`/`ListIcon`/`RowActions`, `TestRow`, `EmptyState`,
  `StepIndicator`, `CostEstimate`, `GenerationStatus`, `OptionCard`)
  standardize lists and page layouts across core pages. Header and navigation
  are consolidated in `components/layout/AppLayout.tsx`.
- Automatic database backups: a consistent database copy is saved to
  `data/backups/` shortly after startup and daily thereafter; the 14 most
  recent copies are retained. A new API endpoint supports immediate backups
  (a UI card will follow in the planned redesign).
- Regression tests for assigning flashcard reviews to concurrent study sessions.
- Frontend unit tests for starting offline study.
- An `npm test` command using Vitest for frontend unit tests.
- Actual cancellation of the pending generation request in the browser
  using `AbortController`.

### Changed

- Geist/Geist Mono font stack replaces Outfit/JetBrains Mono; corner radius
  is 0.5rem. Decorative gradients, glassmorphism and glow effects,
  `.stagger-*` utilities, and fade-in animations have been removed.
- Study cards use theme tokens (“Question”/“Answer” labels, ratings mapped
  to destructive/warning/primary/success). Card status and rating colors
  are centralized in `lib/studyColors.ts`; score color helpers
  (`getScoreColor`/`getScoreBgColor`) are in `lib/utils.ts`.
- Subject and flashcard pages use the shared page layout. All nine core pages
  fit a 390 px viewport; subject score thresholds are standardized at 80/60
  (previously 70/50).
- Test and template generation status responds immediately to cancellation
  requests.
- The offline queue explicitly checks whether a locally saved study queue
  is available when starting a deck.
- Review records now store their study session so session statistics can be
  aggregated accurately.
- Generation request count fields (`num_cards`, `num_questions`, `num_choices`)
  have server-side bounds (1–100 cards or questions, 2–10 answer choices);
  invalid values are rejected with 422.
- Quiz generation fallback strategies request only the missing number of
  questions; previously generated, paid-for questions are reused rather
  than discarded.
- Deck and subject overview pages calculate statistics in aggregate rather
  than per item, noticeably improving list performance with larger datasets.
- The database uses WAL mode with a five-second busy timeout: reads (for
  example, during long AI generation) no longer block other operations' writes.
- FastAPI validation errors display readable frontend messages (field and
  cause) rather than “[object Object]”.

### Fixed

- Review bars on the Stats page previously had zero height.
- Template score sparklines now load historical data
  (`placeholderData` instead of `initialData`).
- Flashcard cost estimates use token prices per million tokens without
  dividing the price by 1,000,000 twice.
- The deck detail page no longer overflows at 390 px width.
- Offline study can start after a reload or a fresh launch without a network
  connection using a previously saved queue.
- Cancelling completed or failed test generation no longer falsely reports
  success. The API returns a conflict with the actual final state instead.
- Cancellation requested immediately before persistence prevents the
  generated test from being saved.
- Overlapping study sessions for the same deck no longer mix review and
  rating statistics.
- The SM-2 ease factor penalty is no longer applied twice, and study sessions
  receive the correct study date on every review.
- Dates, times, and the “see again in …” hint after rating are no longer
  shifted by the browser's timezone offset outside UTC. API timestamps
  without a timezone are interpreted as UTC.
- Study rating buttons are accessible again on phones in landscape mode
  (scrollable card area and bounded card height).
- Answers and rating buttons are inaccessible to keyboard navigation and
  screen readers until the card is flipped.
- The “Study” button on a deck with no due cards is actually disabled and
  no longer opens a study session.
- The installed PWA starts with a light splash screen instead of an almost
  black one.
- Generating more than 30 flashcards no longer fails with a server error,
  and cards with JSON `null` for front/back no longer invalidate the entire batch.
- Unknown `/api/` paths return an actual HTTP 404 instead of HTTP 200 with
  a “Not Found” body.
- The offline queue no longer sends ratings twice, loses entries added during
  an ongoing synchronization, or silently discards offline ratings when their
  study session has already been completed.
- Offline synchronization runs throughout the app, rather than only during
  an open study session; deck, Dashboard, and streak counts update afterward.
- Completing a study session offline displays the summary instead of an
  error page.
- Failed frontend actions (deleting, saving, flashcard creation, AI verification)
  show visible errors instead of failing silently. Deleting a document
  requires confirmation.
- Test and deck lists update immediately after create-and-generate operations.
- Resuming an interrupted study session no longer creates phantom or duplicate
  sessions, and the study view no longer freezes during rapid ratings or
  completion (P2.1/P2.2).
- Failed AI calls during subject generation no longer leave empty test or
  card objects, and other actions are no longer blocked by a database lock
  during generation (previously up to two minutes).
- Generation returns a clear 404 when referenced documents are missing
  (for example, after deletion), rather than silently generating without
  the study material.
- Deletion consistently cleans up related data: deleting a test or template
  leaves no orphaned tests, questions, or card references; deleting a deck
  leaves no review rows; document references are removed from test, deck,
  and subject configurations.
- Cancelling quiz question generation stops generation completely; no further
  AI requests are sent in the background.
