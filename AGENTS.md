# AGENTS.md — Projektgedächtnis & Konventionen für AI Agents

> Diese Datei ist die zentrale Referenz für jeden AI Agent (OpenCode, Claude Code usw.), der an **Scio** arbeitet. Lies sie vollständig, bevor du Änderungen machst. Halte sie aktuell, wenn sich Konventionen oder Start-Befehle ändern.

Follows the SG303 baseline v1 (`sgstack/global/AGENTS.md`,
`sgstack/baseline/tools.md`). Where this file and the global rules overlap,
this file adds project detail; the global Git and security rules always apply.

## Arbeitsweise — Grundprinzipien

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```text
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## Projektüberblick

Scio ist eine **persönliche Lern-Web-App** („Your AI Learning Hub"): AI-generierte Flashcards und Practice-Quizzes zur Prüfungsvorbereitung, mit SM-2-Spaced-Repetition für Flashcards. Karten und Fragen werden über die OpenRouter-API von frei wählbaren Modellen erzeugt – oder über die Claude-Subscription des Besitzers (offizielle Claude-Code-CLI).

**Wichtige Rahmenbedingungen:**

- **Single-User-Projekt.** Kein Auth, keine Multi-User-Funktionen — gewollt, nicht vergessen. Füge keine Login-/Benutzerverwaltung hinzu. Die App läuft nur im lokalen Netzwerk bzw. via Tailscale.
- Der Besitzer ist **kein Entwickler**: Ergebnisse müssen in der UI klickbar prüfbar sein, nicht über Kommandozeilen-Ausgaben.
- Jeder OpenRouter-Call **kostet echtes Geld** des Besitzers. Generierungs-Logik so bauen, dass nicht unnötig ganze Generierungen wiederholt werden (Teilergebnisse wiederverwenden statt verwerfen).

## Tech-Stack

| Layer | Technologie |
|-------|-------------|
| Backend | FastAPI (async), SQLAlchemy 2.0 async, aiosqlite, Pydantic v2 |
| Frontend | React 18, TypeScript, Vite, TanStack Query v5, React Router v6, Tailwind, shadcn/ui |
| Daten | SQLite unter `data/scio.db` |
| AI | OpenRouter Chat-Completions (`app/services/openrouter.py`, `test_generator.py`, `flashcard_generator.py`) |
| Deployment | Docker (Multi-Stage-Image), Docker Compose, GitHub Actions → ghcr.io |

## Codebase-Struktur

```
backend/
  app/
    main.py              # FastAPI-App, Lifespan (init_db, Migrationen, Model-Seeding), SPA-Static-Serving
    config.py            # pydantic-settings; Pfade, OPENROUTER_API_KEY (Fallback) & CLAUDE_CLI_HOME via .env
    database.py           # async engine + session factory + get_db-Dependency
    models.py            # SQLAlchemy-Modelle (Zeitstempel immer timezone-aware via utc_now())
    routers/             # HTTP-Endpunkte: documents, ai_models, tests, flashcards, subjects
    schemas/             # Pydantic-Request/Response-Modelle (ein Modul pro Domäne)
    services/            # Geschäftslogik: spaced_repetition (SM-2), test_generator,
                         # flashcard_generator, document_parser, openrouter (Model-Cache),
                         # openrouter_client (gemeinsamer JSON-API-Call mit response_format,
                         # routet Subscription-Modelle an claude_cli), openrouter_key (Key aus
                         # Settings-Tabelle oder Env), claude_cli (Claude-Code-CLI: Install, Login, -p),
                         # subject_materials (Subject-Prüfung + Dedupe-Quellen),
                         # document_chapters (Bücher in Kapitel-Dokumente aufteilen)
    migrations/          # idempotente Migrations-Skripte, laufen beim Startup (lifespan)
frontend/
  src/
    pages/               # Alle Seiten; Unterordner flashcards/ und subjects/
    components/ui/       # shadcn/ui-generierter Code — NICHT manuell anpassen
    components/flashcards/FlashcardStudy.tsx  # Kern-Lern-UI
    services/api.ts      # Alle fetch-Aufrufe (fetchApi-Wrapper)
    lib/constants.ts    # Geteilte Konstanten (Query-Keys hierher auslagern)
    lib/utils.ts         # Helpers (u. a. Kostenschätzung)
  package.json          # Scripts: dev / build / preview / typecheck / lint
Dockerfile              # Multi-Stage: Frontend-Build → Python-Image mit Static-Files
docker-compose.yml.template
frontend/eslint.config.js  # ESLint-Regeln; shadcn-Code in src/components/ui/ ist von bestimmten Regeln ausgenommen
.github/workflows/       # docker-build.yml, tests.yml (pytest + frontend typecheck/lint bei jedem Push/PR)
data/                   # SQLite-DB (runtime, git-ignored ausser .gitkeep)
uploads/                # Hochgeladene Dokumente (runtime)
```

## Lokale Entwicklung

**Backend** (aus `backend/`, virtuelle Umgebung mit `requirements.txt`):

```bash
cd backend
pip install -r requirements.txt
cp ../env.example .env        # OPENROUTER_API_KEY eintragen (nur für AI-Generierung nötig;
                             # alle anderen Endpunkte funktionieren ohne Key)
uvicorn app.main:app --reload --port 8000
```

Hinweis: Ohne Docker-`/app/data`-Verzeichnis landet die lokale DB relativ zum CWD in `backend/data/scio.db`. Per `DATABASE_PATH` in `.env` überschreibbar.

**Frontend** (aus `frontend/`):

```bash
cd frontend
npm install
npm run dev        # Vite-Dev-Server (Port 3000, API-Proxy s. vite.config.ts)
npm run build      # tsc + vite build → dist/
```

**Docker (Produktions-Setup des Besitzers):**

```bash
cp docker-compose.yml.template docker-compose.yml   # OPENROUTER_API_KEY setzen
docker compose build && docker compose up -d         # Port 8001→8000
curl http://localhost:8001/api/health                 # Health-Check
```

## Datenbank & Migrationen — kritische Regeln

1. SQLAlchemy `create_all` läuft beim **Startup** (`init_db`) und legt fehlende Tabellen mit dem vollständigen ORM-Schema an. Handgeschriebene Migrationen sind nur für **neue Spalten an bestehenden Tabellen** nötig.
2. Migrationen in `app/migrations/` müssen **idempotent** sein (immer `PRAGMA table_info`-Check vor `ALTER TABLE`, immer `if table exists`-Check vor `CREATE TABLE`). Sie laufen bei jedem Startup in `main.py`-lifespan — ein Fehler blockiert den kompletten App-Start.
3. **P5.3 erledigt:** `study_sessions` hat jetzt alle ORM-Spalten (`cards_studied_json`, `new_cards_reviewed_today`, `study_date`) — per CREATE TABLE und idempotenten ALTERs mit PRAGMA-Check. Bleibende Regel: Wenn das ORM neue Spalten bekommt, die zugehörige Migration nie "unberührt" lassen.
4. SQLite: `PRAGMA foreign_keys` ist per Default **aus** — dangling FKs passieren still. Bei Referenz-Löschungen (z. B. AI-Modelle) immer explizit referenzierende Objekte prüfen.
5. Bestehende Nutzer-DBs sind heilig: Migrationen nie mit `DROP`/`RENAME` auf Daten-Tabellen "vereinfachen".

## Konventionen

**Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`). Ein Commit = eine logische Änderung. Keine Mixing von Refactoring und Feature.

**GitHub language:** All content published to GitHub must be in English,
including commit messages, PR titles and descriptions, issues, review comments,
release notes, and repository documentation such as `CHANGELOG.md` and
`RELEASING.md`. New or updated documentation and changelog headings must also
be in English. Translating historical entries must preserve their meaning,
versions, and dates; never rewrite tags or published release artifacts.
Conversation with the owner may remain in German.

**Backend:**
- Zeitstempel **immer** timezone-aware (`datetime.now(timezone.utc)`) — zentral via `utc_now()`.
- Kein `print()` — `logging` verwenden.
- Queries bevorzugt als **Aggregation** (`select(func.count())`, `GROUP BY`) statt Objekt-Materialisierung; keine N+1-Patterns ( Schleifen über `db.execute` vermeiden).
- Request/Response-Modelle immer als Pydantic-Schemas in `app/schemas/` pflegen, nicht inline.
- AI-Generierungs-Logik gehört in `app/services/`, nie in Router-Dateien.

**Frontend:**
- `components/ui/` ist generierter shadcn-Code: **nicht** manuell ändern.
- Server-State ausschliesslich über TanStack Query (`useQuery`/`useMutation`). Nach Mutationen **alle betroffenen Query-Keys invalidieren** (Query-Keys als Konstanten in `lib/constants.ts`).
- Jede Mutation braucht sichtbares Fehler-Handling (kein stiller `catch`).
- UI-Sprache der App ist **Englisch**; neue UI-Texte entsprechend halten.

## Release Management (mandatory)

- Read **[RELEASING.md](RELEASING.md) in full** before release work.
- Document relevant changes under `## [Unreleased]` in `CHANGELOG.md`.
  Do not bump versions for every change.
- The authoritative app version is `backend/app/VERSION`; synchronize frontend
  versions using `python3 scripts/release.py prepare X.Y.Z`.
- Before completing work, run `python3 scripts/release.py check` and
  `python3 -m unittest discover -s scripts -p 'test_*.py'` in addition to
  existing checks; also run frontend and Docker builds before releases.
- Prepare releases as `chore: release vX.Y.Z` and merge into `main` through a PR.
  Explicitly pushing a tag triggers tests → GHCR image → GitHub Release.
- Tag and push releases only when publication has been requested. Never change
  existing tags. Setting up the process alone does not publish anything.
  See `RELEASING.md` for updates, backups, and rollback; never reset user data
  automatically.

## Verification — Definition of Done (Pflicht vor jedem Commit)

| Check | Befehl | Status |
|-------|--------|--------|
| Backend-Tests | `cd backend && pytest` | Verfügbar seit P0.2 (`backend/tests/`, Dependencies: `pip install -r requirements-dev.txt`). Läuft auch als GitHub-Actions-Job bei jedem Push/PR |
| Frontend-Typecheck | `cd frontend && npm run typecheck` | Verfügbar seit P0.3 |
| Lint | `cd frontend && npm run lint` | Verfügbar seit P0.3. Bestehende Warnungen sind bekannte, geplante Bugs (siehe `eslint.config.js`) und blockieren nicht |
| Docker-Build | `docker build .` (nur bei Dockerfile/Compose-Änderungen) | Verfügbar |

**Eiserne Regel: Niemals committen, wenn ein verfügbarer Check rot ist.** Das gilt seit P0.2/P0.3 für `pytest`, `typecheck` und `lint` ohne Ausnahme.

Zusätzlich gilt für jedes abgeschlossene Arbeitspaket: Der Besitzer prüft das Ergebnis **durch Benutzen der App** (Klick-Test). Liefere deshalb mit jeder Änderung eine einzeilige, nicht-technische Prüf-Anleitung („Studiere 5 Karten → nach Reload erscheint Resume-Prompt").

## Nicht-Ziele & Landminen

- **Nicht tun:** Auth/Multi-User, neue Abhängigkeiten ohne Not, Änderungen an `components/ui/`, Umbau von SM-2-Konstanten ohne neue Tests, Aufrüstung auf anderes DB-System.
- **UI-Überarbeitung abgeschlossen (PRs #22–#24):** Themes und
  Design-Tokens leben in `frontend/src/index.css` (`:root` = Light,
  `.dark` = Dark). Neue UI-Arbeit muss die semantischen Tokens, die
  gemeinsamen Komponenten in `frontend/src/components/` (PageHeader,
  List/RowActions, EmptyState, OptionCard u. a.) und die Karten-Status-
  und Bewertungsfarben aus `lib/studyColors.ts` verwenden.
  `components/ui/` bleibt generierter shadcn-Code und damit tabu.
- **Landmine 1 (gelöst, P4.3):** Die doppelte `_build_interleaved_queue`-Definition in `spaced_repetition.py` wurde entfernt — es existiert nur noch die aktive Definition.
- **Landmine 2 (mit P1.1 behoben):** `test_generator.py` verwirft ungültige `correct_answer`-Indizes (ausserhalb `0..len(choices)-1`, nicht konvertierbar, fehlend) mit `logger.warning`, statt sie still auf einen gültigen Index zu klemmen. **Niemals Clamping-Muster (`max(0, min(...))`) auf Antwort-Schlüssel zurückbringen oder auf neue Codepfade kopieren** — ein geklemmter Schlüssel lehrt eine falsche Antwort als richtig.
- **Landmine 3 (mit P1.2 behoben):** Alle OpenRouter-Calls laufen über `app/services/openrouter_client.py` mit `response_format: json_object` (Automatisch-Retry ohne, falls ein Modell es nicht unterstützt). Reparatur-Regexes laufen **nur noch nach gescheitertem `json.loads`** und **nur innerhalb von `"choices": [...]`-Arrays** (`_repair_choices_arrays`). **Niemals globale Regex-Substitutionen über den AI-Response einbauen** — sie zerstören legitime Frage-/Erklärungsinhalte.
- **Landmine 4 (gelöst, P5.2):** Bei allen Generierungs-Endpunkten (`tests.py`, `flashcards.py`, `subjects.py`) läuft der AI-Call **vor** dem ersten Write — keine offene SQLite-Schreib-Transaktion während des Calls. Muster für neue Generierungs-Endpunkte beibehalten: Reads → AI-Call → Persistenz in einem Commit, Kontrakt-Test „fehlgeschlagene Generierung hinterlässt keine leere Config/Deck".

## Architektur-Entscheide (dokumentiert gemäss Roadmap)

- **Generierungs-Fortschritt (P6.2) — Polling statt SSE:** Der Fortschritt langer KI-Generierungen läuft über ein einfaches Polling (`GET /api/generation/progress/{token}`, 1,5 s Intervall) statt Server-Sent-Events. Grund: kein WebSocket/SSE in FastAPI nötig, keine Proxy-Konfiguration für Tailscale nötig, Code bleibt simpel. Cancel ist kooperativ: das Frontend setzt ein Flag, der Generator prüft es zwischen den Batches und wirft `GenerationCancelled`. Ein bereits laufender OpenRouter-Call läuft fertig, das Resultat wird verworfen. Wer je auf SSE/Streams umstellt: `generation_progress.py` und `hooks/useGenerationProgress.ts` sind die einzigen Berührungspunkte.
- **Offline-Studium (P6.4) — localStorage-Queue:** Die Study-Queue eines Decks wird beim Laden in `localStorage` gespiegelt; offline abgegebene Bewertungen landen in einer Queue (`lib/offlineQueue.ts`) und werden bei `online`-Event **in Reihenfolge** repliziert (letzte Bewertung gewinnt, SM-2-Reihenfolge bleibt erhalten). HTTP-Fehler beim Replizieren (z. B. 404 für gelöschte Karte) werden verworfen, Netzwerkfehler bleiben queued. Nur wenn das Gerät **online**, der Server aber nicht erreichbar ist (z. B. Tailscale down), greift die localStorage-Queue; ist das Gerät selbst offline, pausiert TanStack Query die Rating-Anfrage und setzt sie bei wiederhergestellter Verbindung fort — die lokale Queue kommt dann nicht zum Zug (verhalten unverändert, durch manuellen Test bestätigt).
- **PWA (P6.4):** Manifest + Service Worker über `vite-plugin-pwa` (autoUpdate). `/api/**` ist nie im Service-Worker-Cache (`navigateFallbackDenylist`) — die API braucht den Server, offline fliegen API-Calls kontrolliert in die react-query-Fehlerpfade.
- **SQLite-Pragmas (Runde 4):** WAL + `busy_timeout=5000 ms` werden pro Verbindung via `connect`-Event in `database.py` gesetzt — die offene READ-Transaktion über den AI-Call blockiert keine Writes mehr. In-Memory-Test-Engines erstellen eigene Engines und hängen nicht am App-Engine-Event.
- **Menü & Subjects (Runde 5):** Vier Hauptbereiche (Dashboard, Subjects, Flashcards, Tests), „New"-Menü und Zahnrad (`/settings`, Tabs AI models | AI providers | Test templates). Documents sind global und liegen als Tab unter Subjects; ein Subject merkt sich nur Standard-Dokumente (Vorauswahl, nie exklusiv). Tests und Decks werden in den normalen Wizards optional einem Subject zugewiesen (`subject_id`), nachträglich über „Assign subject". Mit `subject_id` dedupliziert `create-and-generate` gegen die vorhandenen Fragen/Karten des Subjects (`subject_materials.py`).
- **Claude-Subscription (Runde 6) — offizielle CLI statt Token:** Subscription-Modelle haben die Model-ID `claude-subscription/<alias>` (opus/sonnet/haiku); `openrouter_client.chat_completion_json` erkennt das Präfix und ruft `claude_cli.chat_completion` (`claude -p`, **alle Tools aus** via `--tools ""`, Prompt über stdin, leeres Temp-Arbeitsverzeichnis, `ANTHROPIC_*` aus der Env entfernt). Kein DB-Feld „Provider", keine Migration. Scio liest, speichert oder leitet **nie** Claude-Tokens weiter: der Web-Login startet `claude auth login`, zeigt die Anthropic-URL und reicht nur den Einmal-Code an die CLI weiter; Tokens verwaltet die CLI selbst. Grund: Anthropics Bedingungen verbieten Apps das Sammeln/Vermitteln von Claude-Credentials (Tools wie OpenCode/Cline/CLIProxyAPI, die Tokens selbst nutzen, wurden 2026 gesperrt). Die CLI ist **nicht** im Docker-Image (öffentliches Repo/Image = keine Weiterverteilung proprietärer Software); sie wird per Klick mit dem offiziellen Installer nach `CLAUDE_CLI_HOME` (`/app/claude`, Volume) installiert und aktualisiert sich dort selbst. Niemals Werkzeuge für `claude -p` freischalten, ohne das Prompt-Injection-Risiko durch hochgeladene Dokumente zu bewerten.
- **OpenRouter-Key im Web-UI:** Der Key liegt in der Settings-Tabelle (`openrouter_api_key`) und hat Vorrang vor `OPENROUTER_API_KEY`; die API gibt nur die letzten 4 Zeichen zurück. Vor dem Speichern prüft `GET /key` bei OpenRouter den Key (kostenlos).
- **Templates sind reine Vorlagen:** Ein Template wird im Wizard nur *kopiert* (`?template=`), nie verknüpft. `create-and-generate` schreibt immer `is_template=False`, `POST /tests/generate/{id}` lehnt Template-IDs ab und Templates bekommen nie ein `subject_id`. Grund: der `TestConfig.tests`-Cascade würde beim Löschen eines Templates alle daran hängenden Tests mitlöschen. Alt-Tests, die noch an einem Template hängen, zeigt die Löschbestätigung über `test_count` an.
- **Exam Objectives steuern den Fokus:** Dokumente vom Typ `exam_objectives` sind kein Lernstoff, sondern die Lernziele der Prüfung. Sind sie ausgewählt, setzen die Generatoren sie in einen eigenen Prompt-Abschnitt „EXAM OBJECTIVES" mit der Anweisung, Fragen/Karten darauf auszurichten (`services/exam_objectives.py`). Sie bleiben im Wizard frei abwählbar (Wunsch des Besitzers) — nicht automatisch erzwingen.
- **Vorlesungsnotizen (Lectures):** Tabelle `lectures` (gehört fest zu einem Subject, Markdown in `content`), Router `routers/lectures.py`. Bilder liegen unter `<uploads>/lectures/<id>/<uuid>.<ext>` (nur PNG/JPEG/GIF/WebP, **kein SVG** wegen Skripten), das Markdown verlinkt `/api/lectures/{id}/images/{name}`. Löschen einer Vorlesung löscht ihren Bilderordner; ein Subject mit Vorlesungen lässt sich nicht löschen (409), Notizen werden nie implizit mitgelöscht. Editor: Milkdown Crepe, lazy geladen (`components/lectures/MarkdownEditor.tsx`, Farben über `markdown-editor.css` an die Tokens gebunden). Das Dock (`LectureDock` in `App.tsx`, State über `LectureEditorProvider` in `main.tsx`) überlebt Navigation; minimiert bleibt der Editor gemountet. Autosave 1,2 s nach der letzten Änderung; jede Änderung landet zusätzlich in `localStorage` (`scio-lecture-draft:<id>`) und gewinnt beim nächsten Öffnen, bis der Server sie bestätigt. Achtung: `db_backup.py` sichert nur die DB, nicht die Bilder im uploads-Volume.
- **Vorlesung abschliessen (KI-Formatierung):** `POST /api/lectures/{id}/format` (`services/lecture_formatter.py`) korrigiert Rechtschreibung und strukturiert das Markdown, **ohne Inhalt hinzuzufügen oder zu entfernen**. Das Ergebnis wird sofort gespeichert, der Text davor landet in `original_content` (Vergleichsansicht mit Wort-Diff im Dock, „Restore original" per PATCH). Ein Call pro Klick, das Ergebnis geht nie verloren. Der Server verwirft das Ergebnis, wenn sich die Menge der Bild-URLs ändert — dieser Check darf nicht entfallen. Vor dem Call speichert das Frontend die Notizen; während der Formatierung ist der Editor gesperrt. Spalten `original_content`/`formatted_at` per idempotenter Migration `add_lecture_formatting.py`.
- **Vorlesungen als Lernstoff:** Tests und Decks speichern ihre Quell-Vorlesungen in `lecture_ids` (JSON, wie `document_ids`; Migration `add_lecture_sources.py`). `services/lecture_sources.py` macht daraus dokumentähnliche Objekte (`doc_type="lecture_notes"`, Bild-Links entfernt) für die Generatoren; alle Folge-Generierungen (Deck nachgenerieren, Add questions/cards, neuer Test aus Config) nutzen die gespeicherten `lecture_ids`. Fehlende Vorlesung = 404 vor dem KI-Call; beim Löschen einer Vorlesung wird ihre ID aus allen `lecture_ids` entfernt. Templates bekommen nie `lecture_ids` (Vorlesungen gehören zu einem Subject). Im Wizard erscheinen Vorlesungen nur mit gewähltem Subject; `?lecture=<id>` (zusammen mit `?subject=`) wählt eine vor.
- **Bücher in Kapitel aufteilen:** Ein Dokument (meist ein grosses PDF) wird auf Wunsch in ein Dokument pro Hauptkapitel geteilt (`services/document_chapters.py`, `POST /api/documents/{id}/chapters/detect` → Vorschau, `POST /api/documents/{id}/chapters` → Anlegen). Erkennung billig zuerst: PDF-Lesezeichen bzw. DOCX-„Heading 1“/Markdown-`#`; nur bei PDFs ohne Lesezeichen und nur auf Klick die KI. Die KI sieht **nie das ganze Buch**, nur die ersten Seiten (Inhaltsverzeichnis) und den Seitenanfang jeder Seite, und liefert nur Startseiten; den Text schneidet immer der Server zu (`locate_chapters` korrigiert gedruckte vs. PDF-Seitenzahlen). Nichts wird gespeichert, bevor der Besitzer die Vorschau bestätigt. Kapitel sind normale Dokumente mit `parent_document_id` (+ `page_start`/`page_end` bei PDFs; Migration `add_document_chapters.py`) und erben den `doc_type`; das Buch bleibt erhalten. Ein Buch wird nur einmal geteilt (409), Kapitel nicht weiter. Löschen eines Buchs löscht seine Kapitel mit (Referenzen werden bereinigt). UI gruppiert Kapitel unter dem Buch (`lib/documents.ts`, `DocumentPicker`, Documents-Seite).

- **Cross-origin write protection:** API mutations reject browser Origins other than the request origin or an explicit `ALLOWED_ORIGINS` entry. `*` only enables CORS reads, never arbitrary cross-origin writes. Requests without Origin remain available to CLI clients unless `Sec-Fetch-Site` is `cross-site`. Reverse proxies must preserve the public Host and forward `X-Forwarded-Proto`; the Docker image sets `FORWARDED_ALLOW_IPS=*` so uvicorn honors it from any peer (uvicorn's default only trusts 127.0.0.1, which broke every write behind Traefik); the Vite development proxy preserves Host too.

## Deviations from baseline

- `tool-canon`: the backend uses `requirements.txt` with pip instead of uv;
  `scripts/` are plain Python scripts tested with `unittest`. Moving the
  backend to uv is planned as a separate change.
- Language: this file is still in German; translating it to English is
  planned as a separate change.
