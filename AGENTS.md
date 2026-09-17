# AGENTS.md — Projektgedächtnis & Konventionen für AI Agents

> Diese Datei ist die zentrale Referenz für jeden AI Agent (OpenCode, Claude Code usw.), der an **Scio** arbeitet. Lies sie vollständig, bevor du Änderungen machst. Halte sie aktuell, wenn sich Konventionen oder Start-Befehle ändern.

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

Scio ist eine **persönliche Lern-Web-App** („Your AI Learning Hub"): AI-generierte Flashcards und Practice-Quizzes zur Prüfungsvorbereitung, mit SM-2-Spaced-Repetition für Flashcards. Karten und Fragen werden über die OpenRouter-API von frei wählbaren Modellen erzeugt.

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
    config.py            # pydantic-settings; Pfade & OPENROUTER_API_KEY via .env
    database.py           # async engine + session factory + get_db-Dependency
    models.py            # SQLAlchemy-Modelle (Zeitstempel immer timezone-aware via utc_now())
    routers/             # HTTP-Endpunkte: documents, ai_models, tests, flashcards, subjects
    schemas/             # Pydantic-Request/Response-Modelle (ein Modul pro Domäne)
    services/            # Geschäftslogik: spaced_repetition (SM-2), test_generator,
                         # flashcard_generator, document_parser, openrouter (Model-Cache),
                         # openrouter_client (gemeinsamer JSON-API-Call mit response_format)
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
npm run dev        # Vite-Dev-Server (Port 5173, API-Proxy s. vite.config.ts)
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
3. **Bekannte Lücke:** `study_sessions` in `add_flashcard_tables.py` ist ohne die Spalten `cards_studied_json`, `new_cards_reviewed_today`, `study_date` definiert, die das ORM erwartet — Nachzug per PRAGMA-Check folgt in Package P5.3. Solange: diese Tabelle in Migrationen nie "unberührt" lassen, wenn das ORM neue Spalten bekommt.
4. SQLite: `PRAGMA foreign_keys` ist per Default **aus** — dangling FKs passieren still. Bei Referenz-Löschungen (z. B. AI-Modelle) immer explizit referenzierende Objekte prüfen.
5. Bestehende Nutzer-DBs sind heilig: Migrationen nie mit `DROP`/`RENAME` auf Daten-Tabellen "vereinfachen".

## Konventionen

**Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`). Ein Commit = eine logische Änderung. Keine Mixing von Refactoring und Feature.

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
- **Landmine 1:** `_build_interleaved_queue` existiert **doppelt** in `spaced_repetition.py` (erste Definition ist tot). Bei Arbeiten an der Study-Queue immer die zweite (aktive) Definition ändern; vollständige Entfernung ist Package P4.3.
- **Landmine 2 (mit P1.1 behoben):** `test_generator.py` verwirft ungültige `correct_answer`-Indizes (ausserhalb `0..len(choices)-1`, nicht konvertierbar, fehlend) mit `logger.warning`, statt sie still auf einen gültigen Index zu klemmen. **Niemals Clamping-Muster (`max(0, min(...))`) auf Antwort-Schlüssel zurückbringen oder auf neue Codepfade kopieren** — ein geklemmter Schlüssel lehrt eine falsche Antwort als richtig.
- **Landmine 3 (mit P1.2 behoben):** Alle OpenRouter-Calls laufen über `app/services/openrouter_client.py` mit `response_format: json_object` (Automatisch-Retry ohne, falls ein Modell es nicht unterstützt). Reparatur-Regexes laufen **nur noch nach gescheitertem `json.loads`** und **nur innerhalb von `"choices": [...]`-Arrays** (`_repair_choices_arrays`). **Niemals globale Regex-Substitutionen über den AI-Response einbauen** — sie zerstören legitime Frage-/Erklärungsinhalte.
- **Landmine 4:** Der AI-Call bei Generierung läuft aktuell innerhalb einer offenen DB-Transaktion (SQLite-Schreiblock bis zu 120 s). Keine weiteren Endpunkte nach diesem Muster bauen; Auflösung in P5.2.
