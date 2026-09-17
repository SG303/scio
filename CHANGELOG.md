# Changelog

Alle wesentlichen Änderungen an Scio werden in dieser Datei dokumentiert.
Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/)
und verwendet [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt

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

