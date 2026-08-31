import { INTERVIEW_PROMPT } from "./init-prompt.js";

export const ONBOARDING_PROMPT = `Du führst zuerst den sicheren Onboarding-Modus für ein noch nicht verdrahtetes Projekt durch. Arbeite in dieser Reihenfolge und überspringe einen Schritt nur, wenn sein Ergebnis bereits nachweislich vorhanden ist.

1. Repository verstehen
Inspiziere Arbeitsverzeichnis, vorhandene Dateien, git status und gegebenenfalls bestehende Projektmetadaten. Frage den User anschließend gezielt nach allen noch fehlenden Angaben zu Zweck, Sprache und Stack. Mutmaße fehlende Entscheidungen nicht.

2. Projekt-Skeleton sicher vorbereiten
Falls noch kein Git-Repository existiert, führe über die Shell git init -b develop aus. Lege ein zum bestätigten Stack passendes minimales Projekt-Skeleton an. Erzeuge ausschließlich fehlende Dateien und Verzeichnisse; überschreibe, ersetze oder lösche niemals vorhandene Dateien. Prüfe vor jedem Schreiben den Zielpfad. Berücksichtige insbesondere .gitignore, Manifest, Quell- und Testverzeichnisse sowie die benötigten Test-/Coverage-Werkzeuge.

3. Zwingender Vorab-Commit
Prüfe git status, schließe Secrets und ungeeignete Artefakte aus und zeige dem User knapp den vorgesehenen Commit-Inhalt. Committe danach ALLE vorbereitenden und bereits uncommitteten Projektdateien, bevor du trellis init ausführst. Diese Reihenfolge ist zwingend: trellis init installiert anschließend den Branch-Gate-Hook, der direkte Commits auf develop blockiert. Führe niemals trellis init aus, solange git status noch Änderungen für den Vorab-Commit zeigt. Versuche nach trellis init keinen direkten Commit auf develop.

4. Trellis über die Shell initialisieren
Leite einen kurzen Projektnamen ab beziehungsweise bestätige ihn mit dem User und führe ausschließlich über die Shell aus:
trellis init --name <name> --repo <absoluter-repo-pfad>
Merke dir die ausgegebene project-id. Nutze für diesen Schritt kein MCP.

5. Gate-Rezept über die CLI konfigurieren
Führe trellis config bewusst über die Shell-CLI aus, niemals über MCP. Ergänze eine knappe Description und verwende passend zum Stack eines dieser erprobten Gate-Rezepte:

TypeScript mit vitest:
- lint: npx tsc --noEmit
- test: npx vitest run --reporter=junit --outputFile=reports/tests.xml --coverage.enabled --coverage.reporter=lcov --coverage.reportsDirectory=reports/coverage
- junit: reports/*.xml
- coverage: reports/coverage/lcov.info

Go:
- lint: go vet ./...
- test: gotestsum --junitfile reports/tests.xml -- -coverprofile=reports/coverage.out ./...
- junit: reports/tests.xml
- coverage: reports/coverage.out

Python mit pytest:
- lint: ruff check
- test: pytest --junitxml=reports/tests.xml --cov --cov-report=lcov:reports/lcov.info
- junit: reports/tests.xml
- coverage: reports/lcov.info

Rufe danach über die Shell auf:
trellis config <project-id> --desc '<beschreibung>' --lint '<lint-command>' --test '<test-command>' --junit '<junit-pfad>' --coverage '<coverage-pfad>'
Für andere Stacks leite analoge Kommandos her. Nicht verhandelbares Kriterium: Der Testlauf erzeugt von Trellis parsebares JUnit-XML und die Coverage liegt als LCOV oder Go-coverprofile vor.

6. Abnahme und Übergang
Führe über die Shell trellis doctor <project-id> aus. Behebe gemeldete Verdrahtungs- oder Gate-Probleme mit denselben Sicherheitsregeln und wiederhole doctor bis zur erfolgreichen Abnahme. Fahre danach ohne neuen Slash-Command unmittelbar mit dem folgenden bestehenden Projekt-Interview fort.`;

export const ONBOARDING_INTERVIEW_PROMPT = `${ONBOARDING_PROMPT}\n\n--- Bestehender Interview-Prompt ---\n\n${INTERVIEW_PROMPT}`;
