# AGENTS.md — Projektgedächtnis & Konventionen für AI Agents

> Diese Datei ist die zentrale Referenz für jeden AI Agent (OpenCode, Claude Code usw.), der an **Scio** arbeitet. Lies sie vollständig, bevor du Änderungen machst. Halte sie aktuell, wenn sich Konventionen oder Start-Befehle ändern.

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
                         # flashcard_generator, document_parser, openrouter (Model-Cache)
    migrations/          # idempotente Migrations-Skripte, laufen beim Startup (lifespan)
frontend/
  src/
    pages/               # Alle Seiten; Unterordner flashcards/ und subjects/
    components/ui/       # shadcn/ui-generierter Code — NICHT manuell anpassen
    components/flashcards/FlashcardStudy.tsx  # Kern-Lern-UI
    services/api.ts      # Alle fetch-Aufrufe (fetchApi-Wrapper)
    lib/constants.ts    # Geteilte Konstanten (Query-Keys hierher auslagern)
    lib/utils.ts         # Helpers (u. a. Kostenschätzung)
  package.json          # Scripts: dev / build / preview (typecheck+lint: siehe P0.3)
Dockerfile              # Multi-Stage: Frontend-Build → Python-Image mit Static-Files
docker-compose.yml.template
.github/workflows/       # docker-build.yml (+ pytest/typecheck-Jobs, siehe «Verification»)
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
| Backend-Tests | `cd backend && pytest` | **Wird mit P0.2 eingerichtet** — bis dahin: Backend muss mindestens starten (`uvicorn app.main:app`) ohne Import-/Startup-Fehler |
| Frontend-Typecheck | `cd frontend && npm run typecheck` | **Wird mit P0.3 eingerichtet** — bis dahin: `npm run build` muss durchlaufen (enthält `tsc`) |
| Lint | `cd frontend && npm run lint` | Wird mit P0.3 eingerichtet |
| Docker-Build | `docker build .` (nur bei Dockerfile/Compose-Änderungen) | Verfügbar |

**Eiserne Regel: Niemals committen, wenn ein verfügbarer Check rot ist.** Sobald P0.2/P0.3 gemerged sind, gilt das für `pytest`, `typecheck` und `lint` ohne Ausnahme.

Zusätzlich gilt für jedes abgeschlossene Arbeitspaket: Der Besitzer prüft das Ergebnis **durch Benutzen der App** (Klick-Test). Liefere deshalb mit jeder Änderung eine einzeilige, nicht-technische Prüf-Anleitung („Studiere 5 Karten → nach Reload erscheint Resume-Prompt").

## Nicht-Ziele & Landminen

- **Nicht tun:** Auth/Multi-User, neue Abhängigkeiten ohne Not, Änderungen an `components/ui/`, Umbau von SM-2-Konstanten ohne neue Tests, Aufrüstung auf anderes DB-System.
- **Landmine 1:** `_build_interleaved_queue` existiert **doppelt** in `spaced_repetition.py` (erste Definition ist tot). Bei Arbeiten an der Study-Queue immer die zweite (aktive) Definition ändern; vollständige Entfernung ist Package P4.3.
- **Landmine 2:** `test_generator.py::parse_questions_response` klemmt ungültige `correct_answer`-Indizes still auf den letzten Choice — das erzeugt **falsche Antwort-Schlüssel**. Fix in P1.1; bis dahin dieses Verhalten nicht "reparieren" und auch nicht auf neue Codepfade kopieren.
- **Landmine 3:** Regex-Substitutionen in `test_generator.py:334-338` laufen global über den AI-Response und können legitime Inhalte zerstören. Fix in P1.2; keine neuen globalen Regex-Fixes hinzufügen.
- **Landmine 4:** Der AI-Call bei Generierung läuft aktuell innerhalb einer offenen DB-Transaktion (SQLite-Schreiblock bis zu 120 s). Keine weiteren Endpunkte nach diesem Muster bauen; Auflösung in P5.2.
