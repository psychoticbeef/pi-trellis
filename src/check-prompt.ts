export const CHECK_PROMPT = `Prüfe den aktuellen Worktree read-only auf Spec-Synchronität, Terminologie-Drift und Code-/Spec-Relikte.

Wenn das Agent-Tool und alle drei Agent-Typen spec-sync-check, glossary-warden und
relic-hunter verfügbar sind, starte alle drei Agenten parallel in einem gemeinsamen
Tool-Turn mit run_in_background: true. Gib jedem den vollständigen Prüfauftrag mit
aktuellem Projekt und Worktree. Sammle anschließend alle drei Ergebnisse ein und führe
ihre Vorschlagslisten zusammen, ohne Code, Specs oder Glossar automatisch zu ändern.

Falls das Agent-Tool oder einer der drei Agent-Typen nicht verfügbar ist, führe jede
betroffene Prüfung vollständig read-only inline aus:
- Spec-Synchronität: Lies den vollständigen Diff einschließlich neuer Dateien, ermittle
  über specs_for_path betroffene Done-Storys, lies deren Done-Bäume mit get_tree(full=true)
  und melde veraltete Spec-Knoten ausschließlich als Vorschlagsliste.
- Terminologie: Lies das Glossar aus get_overview, vergleiche neue oder geänderte Specs
  und Code damit und melde Schreibweisen, konkurrierende Begriffe, Bedeutungsdrift und
  fehlende ultra-kurze Definitionen als Vorschlagsliste.
- Reliktsuche: Führe zuerst npx tsc --noUnusedLocals --noUnusedParameters und bei lokal
  verfügbarem knip danach npx knip aus. Nutze andernfalls Heuristiken. Suche in Code UND
  Spec nach auskommentierten Blöcken, TODO-Leichen, veralteten Kommentaren, ungenutztem
  Code, Imports und Dateien, Done-Knoten zu entferntem Verhalten, Glossar-Termen ohne
  Verwendung und nicht mehr existierenden deklarierten Story-Pfaden. Melde ausschließlich
  belegte Lösch- oder Aktualisierungsvorschläge.

Nenne bei jedem Vorschlag Pfad oder Spec-Knoten, konkreten Beleg und empfohlene Aktion.
Melde für jede Prüfung ausdrücklich „Keine Vorschläge“, wenn sie sauber ist.`;
