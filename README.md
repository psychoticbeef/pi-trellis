# pi-trellis

Eine buildfreie [pi](https://github.com/badlogic/pi-mono)-Extension für Trellis-Projekte. pi lädt den TypeScript-Entry direkt über jiti.

## Installation

Repository einmalig in einer pi-Session laden:

```bash
pi -e /absolute/path/to/pi-trellis
```

Alternativ den lokalen Pfad dauerhaft in `~/.pi/agent/settings.json` (oder projektlokal in `.pi/settings.json`) eintragen:

```json
{
  "packages": ["/absolute/path/to/pi-trellis"]
}
```

Das Projekt benötigt eine `AGENTS.md` mit seiner `trellis-project`-ID und einen verfügbaren `trellis`-Befehl.

## Commands

- `/trellis:on` aktiviert den **Trellis-Modus**, prüft das Projekt und zeigt den Board-Link.
- `/trellis:off` deaktiviert den Trellis-Modus und entfernt den Statusline-Eintrag.
- `/trellis:status` zeigt die aktuelle Kanban-Zusammenfassung ausschließlich in der UI.
- `/trellis:init` startet das geführte Projekt-Interview.
- `/trellis:review [git-range]` startet `change-review` im Foreground; ohne Range wird der Worktree-Diff geprüft.
- `/trellis:check` startet `spec-sync-check`, `glossary-warden` und `relic-hunter` parallel.

Beim Aktivieren werden fehlende read-only **Subagent-Rezepte** create-if-absent unter `.pi/agents` bereitgestellt. `change-review` prüft große Änderungen gegen Architektur- und Cross-Cutting-Specs. `relic-hunter` sammelt belegte Lösch- und Aktualisierungsvorschläge für Code- und Spec-Relikte.

Im aktiven Trellis-Modus ergänzt ein kurzer **Trellis-Kontextblock** jeden User-Turn um Projektübersicht, Glossar, Story-Status und stale Specs.

Nach einer Änderung mit `edit` oder `write` prüft ein **Dateihinweis**, ob die Datei zu einer abgeschlossenen Story gehört. Der Hinweis wird höchstens einmal pro Story und Sitzung für den nächsten User-Turn eingereiht; die aktuell laufende Story ist ausgenommen.
