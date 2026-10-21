# Changelog

Alle wesentlichen Änderungen an Scio werden in dieser Datei dokumentiert.
Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/)
und verwendet [Semantic Versioning](https://semver.org/lang/de/).

## [v0.2.1] - 2026-10-21

### Behoben

- Die Test-Generierung schlug in allen Strategien mit dem Fehler
  „object NoneType can't be used in 'await' expression" fehl: Der
  Fortschritts-Callback im Router war synchron, der Generator awaited
  aber dessen Rückgabewert. Der Callback ist jetzt asynchron; eine
  Regressionstest-Datei sichert das ab.

## [v0.2.0] - 2026-10-21

### Hinzugefügt

- Umfassende UI-Überarbeitung (PRs #22–#24): neues minimalistisches
  Design-System mit vollständigen shadcn-Tokens für Light- und
  Dark-Theme (`frontend/src/index.css`, neutrale Grautöne, Indigo als
  einziger Akzent). Das Theme folgt standardmässig der
  Systemeinstellung; über Sun/Moon im Header umschaltbar, die Wahl wird
  in localStorage unter `scio-theme` gespeichert (ohne Flackern beim
  Start dank Inline-Skript).
- Gemeinsame UI-Komponenten (`PageHeader`, `SectionHeader`,
  `List`/`ListRow`/`ListIcon`/`RowActions`, `TestRow`, `EmptyState`,
  `StepIndicator`, `CostEstimate`, `GenerationStatus`, `OptionCard`)
  vereinheitlichen Listen- und Seitenaufbau über alle Kernseiten;
  Header und Navigation sind in `components/layout/AppLayout.tsx`
  zusammengefasst.
- Automatische Datenbank-Backups: kurz nach dem Start und dann täglich
  landet eine konsistente Kopie der Datenbank in `data/backups/` (die
  14 neuesten bleiben erhalten). Ein Sofort-Backup ist über den neuen
  API-Endpunkt möglich (UI-Karte folgt mit der geplanten Überarbeitung).
- Regressionstests für die Zuordnung von Flashcard-Reviews zu parallelen
  Lernsitzungen.
- Frontend-Unit-Tests für den Einstieg in das Offline-Lernen.
- Einen `npm test`-Befehl auf Basis von Vitest für Frontend-Unit-Tests.
- Einen echten Abbruch des wartenden Generierungsrequests im Browser über
  `AbortController`.

### Geändert

- Neuer Schrift-Stack Geist/Geist Mono (zuvor Outfit/JetBrains Mono),
  Eckradius 0.5rem; dekorative Gradients, Glassmorphism- und
  Glow-Effekte sowie die `.stagger-*`-Utilitys und Fade-in-Animationen
  sind entfernt.
- Die Studienkarte rendert auf Basis der Theme-Tokens („Question"/
  „Answer"-Labels, Bewertungen auf destructive/warning/primary/
  success gemappt); Karten-Status- und Bewertungsfarben sind zentral in
  `lib/studyColors.ts` gebündelt, Score-Farb-Helfer
  (`getScoreColor`/`getScoreBgColor`) liegen in `lib/utils.ts`.
- Fächer- und Flashcard-Seiten nutzen die gemeinsame Seitenanatomie;
  alle neun Kernseiten passen auf 390 px Breite, Fach-Score-
  Schwellen sind vereinheitlicht auf 80/60 (zuvor 70/50).
- Die Statusanzeige von Test- und Vorlagengenerierungen reagiert unmittelbar
  auf einen angeforderten Abbruch.
- Die Offline-Queue stellt explizit fest, ob eine lokal gespeicherte
  Lernwarteschlange für einen Deck-Start verfügbar ist.
- Review-Datensätze speichern nun die zugehörige Lernsitzung, sodass
  Session-Statistiken präzise aggregiert werden können.
- Die Anzahl-Felder der Generierungs-Requests (`num_cards`,
  `num_questions`, `num_choices`) sind serverseitig begrenzt (1–100
  Karten bzw. Fragen, 2–10 Antwortoptionen); ungültige Werte werden
  mit 422 abgelehnt.
- Bei der Quiz-Fragen-Generierung fragen Fallback-Strategien nur noch
  die fehlende Anzahl nach; bereits generierte (bezahlte) Fragen werden
  wiederverwendet statt verworfen.
- Die Übersichtsseiten von Decks und Fächern berechnen ihre Statistiken
  gesammelt statt pro Element — bei grösserem Datenbestand spürbar
  schnellere Listen.
- Die Datenbank läuft im WAL-Modus mit 5 Sekunden Sperr-Wartezeit:
  Lesezugriffe (z. B. während einer langen KI-Generierung) blockieren
  Schreibvorgänge anderer Aktionen nicht mehr.
- FastAPI-Validierungsfehler zeigen im Frontend eine lesbare Meldung
  (Feld + Ursache) statt „[object Object]".

### Behoben

- Die Review-Balken der Stats-Seite hatten zuvor eine Höhe von null.
- Die Score-Sparkline einer Vorlage lädt jetzt tatsächlich
  Verlaufsdaten (placeholderData statt initialData).
- Die Flashcard-Kostenschätzung rechnet mit Token-Preisen
  (pro Million Tokens), statt den Preis doppelt durch 1.000.000 zu
  teilen.
- Die Deck-Detail-Seite überläuft bei 390 px Breite nicht mehr.
- Offline-Lernen kann nach einem Reload oder einem frischen Start ohne
  Netzwerk mit einer bereits gespeicherten Warteschlange beginnen.
- Der Abbruch einer abgeschlossenen oder fehlgeschlagenen Testgenerierung
  meldet nicht mehr fälschlich Erfolg. Der API-Endpunkt liefert in diesen
  Fällen den tatsächlichen Endzustand als Konflikt zurück.
- Ein unmittelbar vor dem Persistieren angeforderter Abbruch einer
  Testgenerierung verhindert das Speichern des Ergebnisses.
- Überlappende Lernsitzungen desselben Decks vermischen ihre Review- und
  Rating-Statistiken nicht mehr.
- Die SM-2-Ease-Factor-Strafe wird nicht mehr doppelt angewendet, und
  Lernsitzungen erhalten bei jedem Review ein korrektes Tagesdatum.
- Datums- und Zeitangaben sowie der Hinweis „see again in …" nach einer
  Bewertung sind ausserhalb von UTC nicht mehr um die Zeitzonen-
  Verschiebung des Browsers versetzt (API-Zeitstempel ohne Zone werden
  als UTC gelesen).
- Im Querformat auf dem Smartphone sind die Bewertungsknöpfe der
  Lernsitzung wieder erreichbar (Kartenbereich scrollt, Kartenhöhe
  begrenzt).
- Vor dem Umdrehen einer Karte sind Antwort und Bewertungsknöpfe weder
  per Tab noch für Screenreader erreichbar.
- Der „Study"-Knopf eines Decks ohne fällige Karten ist tatsächlich
  deaktiviert und öffnet keine Lernsitzung mehr.
- Die installierte PWA startet mit hellem statt fast schwarzem
  Splash-Screen.
- Die Flashcard-Generierung mit mehr als 30 Karten schlägt nicht mehr
  mit einem Serverfehler ab, und Karten mit JSON-`null` als Front/Back
  verwerfen nicht mehr die gesamte Charge.
- Unbekannte `/api/`-Pfade antworten mit einem echten HTTP 404 statt
  HTTP 200 mit „Not Found"-Rumpf.
- Die Offline-Queue sendet Bewertungen nicht mehr doppelt, verliert
  keine Einträge, die während eines laufenden Synchronisierungslaufs
  hinzukommen, und verwirft Offline-Bewertungen nicht mehr still, wenn
  ihre Lernsitzung inzwischen abgeschlossen wurde.
- Der Offline-Sync läuft app-weit, nicht mehr nur während einer
  offenen Lernsitzung; Deck-, Dashboard- und Streak-Anzahlen
  aktualisieren sich nach der Synchronisierung.
- Nach einer offline abgeschlossenen Lernsitzung erscheint die
  Zusammenfassung statt einer Fehlerseite.
- Fehlgeschlagene Aktionen im Frontend (Löschen, Speichern,
  Flashcard-Erstellung, KI-Verifikation) zeigen sichtbare
  Fehlermeldungen statt still zu scheitern; das Löschen eines
  Dokuments verlangt eine Bestätigung.
- Test- und Deck-Listen aktualisieren sich sofort nach einer
  „Erstellen-und-generieren"-Generierung.
- Das Fortsetzen einer unterbrochenen Lernsitzung erzeugt keine
  Geister- oder Doppelsitzungen mehr, und die Lernansicht friert beim
  schnellen Bewerten oder Beenden nicht mehr ein (P2.1/P2.2).
- Generierungen in einem Fach hinterlassen nach einem fehlgeschlagenen
  AI-Call keine leeren Test- bzw. Karten-Objekte mehr, und während der
  Generierung sind andere Aktionen nicht mehr durch eine
  Datenbanksperre blockiert (bis zu 2 Minuten).
- Generierungen antworten mit einem klaren 404, wenn referenzierte
  Dokumente fehlen (z. B. nach deren Löschung), statt stillschweigend
  ohne das Studienmaterial zu generieren.
- Löschen räumt zugehörige Daten konsistent auf: Ein gelöschter Test
  oder eine Vorlage hinterlässt keine verwaisten Tests, Fragen oder
  Karten-Bezüge, ein gelöschtes Deck keine Review-Zeilen, und
  Dokument-Referenzen werden aus Test-, Deck- und Fach-Konfigurationen
  entfernt.
- Ein angeforderter Abbruch der Quiz-Fragen-Generierung stoppt die
  Generierung vollständig; es werden keine weiteren KI-Anfragen mehr
  im Hintergrund gefeuert.

