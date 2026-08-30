export const CHECK_PROMPT = `Prüfe den aktuellen Worktree auf Spec-Synchronität und Terminologie-Drift.

Wenn das Agent-Tool verfügbar ist und die Agent-Typen spec-sync-check und glossary-warden 
verfügbar sind, spawne beide Agenten parallel in einem gemeinsamen Tool-Turn. Gib jedem 
den vollständigen Prüfauftrag mit aktuellem Projekt und Worktree; sie arbeiten read-only. 
Warte auf beide Ergebnisse und führe ihre Vorschlagslisten zusammen, ohne Specs oder 
Glossar automatisch zu ändern.

Falls das Agent-Tool oder einer der beiden Agent-Typen nicht verfügbar ist, führe die 
betroffene Prüfung inline aus:
- Spec-Synchronität: Lies den vollständigen Diff einschließlich neuer Dateien, ermittle 
  über specs_for_path betroffene Done-Storys, lies deren Done-Bäume mit get_tree(full=true) 
  und melde veraltete Spec-Knoten ausschließlich als Vorschlagsliste.
- Terminologie: Lies das Glossar aus get_overview, vergleiche neue oder geänderte Specs 
  und Code damit und melde Schreibweisen, konkurrierende Begriffe, Bedeutungsdrift und 
  fehlende ultra-kurze Definitionen als Vorschlagsliste.

Nenne bei jedem Vorschlag Pfad oder Spec-Knoten, konkreten Beleg und empfohlene 
Formulierung. Melde für eine Prüfung ausdrücklich „Keine Vorschläge“, wenn sie sauber ist.`;
