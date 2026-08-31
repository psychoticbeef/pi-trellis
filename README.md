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

Global per git-Clone installieren:

```bash
pi install git:git@github.com:psychoticbeef/pi-trellis
```

Das Projekt benötigt eine `AGENTS.md` mit seiner `trellis-project`-ID und einen verfügbaren `trellis`-Befehl.

## Setup in einem neuen Projekt

### Empfohlen: Onboarding-Modus mit `/trellis:init`

Nach der globalen Installation `pi` im neuen Projektverzeichnis starten und `/trellis:init` ausführen. Ohne vorhandene `trellis-project`-Zeile startet der Command den **Onboarding-Modus**: Der Agent inspiziert das Repository, erfragt Zweck, Sprache und Stack, legt ausschließlich fehlende Skeleton-Dateien an und initialisiert bei Bedarf Git auf `develop`. Er erstellt den vollständigen **Vorab-Commit** **vor** `trellis init`, konfiguriert ausschließlich über `trellis config` ein stackgerechtes **Gate-Rezept** für Lint, Tests und Coverage, nimmt die Verdrahtung mit `trellis doctor` ab und geht anschließend direkt zum bestehenden **Interview-Prompt** über. In bereits verdrahteten Projekten startet `/trellis:init` weiterhin sofort den Interview-Prompt.

### Manueller Fallback

Der bisherige manuelle Weg bleibt verfügbar. Vom leeren Verzeichnis bis zur aktiven Extension (Beispiel: TypeScript-Projekt mit vitest):

```bash
mkdir ~/work/mein-projekt && cd ~/work/mein-projekt
git init -b develop

# 1. Projekt-Skelett anlegen (package.json, tsconfig, src/, test/) und
#    VOR trellis init committen — danach blockt der Branch-Gate-Hook
#    direkte Commits auf develop:
git add -A && git commit -m "chore: project skeleton"

# 2. trellis verdrahten (scaffoldet .mcp.json, AGENTS.md mit
#    trellis-project-Zeile, git hooks, .gitignore-Eintrag und committet das selbst):
trellis init --name mein-projekt --repo ~/work/mein-projekt

# 3. Gates konfigurieren (nur via CLI, bewusst nicht via MCP):
trellis config <project-id> \
  --desc 'Einzeiler fürs Board' \
  --lint 'npx tsc --noEmit' \
  --test 'npx vitest run --reporter=junit --outputFile=reports/tests.xml --coverage.enabled --coverage.reporter=lcov --coverage.reportsDirectory=reports/coverage' \
  --junit 'reports/*.xml' \
  --coverage 'reports/coverage/lcov.info'

# 4. Verdrahtung prüfen:
trellis doctor <project-id>
```

Danach `pi` im Projekt starten und den Trust-Dialog mit **Trust** beantworten (Escape überspringt das Laden der Extensions). Die Extension aktiviert sich über die `trellis-project`-Zeile in `AGENTS.md` automatisch und zeigt den Board-Link (`http://127.0.0.1:7420/p/<project-id>/`).

Bei der Installation des **pi-Package** mit `pi install git:git@github.com:psychoticbeef/pi-trellis` installiert `postinstall` die kanonischen **Subagent-Rezepte** automatisch global unter `<agent-dir>/agents` (`agent-dir` ist `$PI_CODING_AGENT_DIR` oder `~/.pi/agent`). `pi update --extensions` frischt diese globale Version überschreibend auf. Projektlokale `.pi/agents/*.md` bleiben reine **Nutzer-Overrides** und haben beim Laden der Subagent-Rezepte Vorrang. Mit `PI_TRELLIS_SKIP_AGENT_INSTALL=1` lässt sich die globale Installation überspringen.

Hinweise:

- Der `release`-Branch (`main`) entsteht beim ersten `trellis release`.
- Bei lokalem Laden außerhalb von `<agent-dir>/git` oder `<agent-dir>/npm` ist `postinstall` absichtlich ein No-op. Fehlt ein Rezept sowohl projektlokal als auch global, legt die Aktivierung es ausschließlich global und create-if-absent an; der Projekt-Worktree bleibt unverändert.
- Wer das pi-trellis-Repo selbst bearbeitet: dort lädt `.pi/settings.json` die lokale Entwicklungsversion — die globale Installation nicht zusätzlich aktivieren, sonst läuft die Extension doppelt.

## Commands

- `/trellis:on` aktiviert den **Trellis-Modus**, prüft das Projekt und zeigt den Board-Link.
- `/trellis:off` deaktiviert den Trellis-Modus und entfernt den Statusline-Eintrag.
- `/trellis:status` zeigt die aktuelle Kanban-Zusammenfassung ausschließlich in der UI.
- `/trellis:init` startet zustandsabhängig den **Onboarding-Prompt** oder den **Interview-Prompt**.
- `/trellis:review [git-range]` startet `change-review` im Foreground; ohne Range wird der Worktree-Diff geprüft.
- `/trellis:check` startet `spec-sync-check`, `glossary-warden` und `relic-hunter` parallel.

Beim Aktivieren werden fehlende read-only **Subagent-Rezepte** nur als globaler create-if-absent-Fallback bereitgestellt; die Extension schreibt keine Rezepte in das Zielprojekt. `change-review` prüft große Änderungen gegen Architektur- und Cross-Cutting-Specs. `relic-hunter` sammelt belegte Lösch- und Aktualisierungsvorschläge für Code- und Spec-Relikte.

Im aktiven Trellis-Modus ergänzt ein kurzer **Trellis-Kontextblock** jeden User-Turn um Projektübersicht, Glossar, Story-Status und stale Specs.

Vor jedem LLM-Aufruf ersetzt die **Context-Hygiene** überholte Trellis-Tool-Results und veraltete `read`-Results außerhalb des Projekts durch kurze Hinweise. Das jüngste Result jedes Trellis-Tools, der aktuelle Turn und die Message-Struktur bleiben erhalten. Das **Aufbewahrungsfenster** für externe Reads beträgt standardmäßig drei abgeschlossene Turns und kann mit `TRELLIS_CONTEXT_READ_MAX_AGE_TURNS` auf eine nichtnegative Ganzzahl gesetzt werden.

Nach einer Änderung mit `edit` oder `write` prüft ein **Dateihinweis**, ob die Datei zu einer abgeschlossenen Story gehört. Der Hinweis wird höchstens einmal pro Story und Sitzung für den nächsten User-Turn eingereiht; die aktuell laufende Story ist ausgenommen.
