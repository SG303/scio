# Changelog

Alle wesentlichen Änderungen an Scio werden in dieser Datei dokumentiert.
Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/)
und verwendet [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt

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

