export function buildReviewPrompt(gitRange: string): string {
  const diffSource = gitRange.length === 0
    ? "Es wurde kein Git-Range übergeben. Prüfe den vollständigen Worktree-Diff einschließlich neuer Dateien."
    : `Der folgende Git-Range wurde unverändert vom Command übernommen:\n${JSON.stringify(gitRange)}`;

  return `Prüfe eine große Änderung mit dem read-only Subagent-Rezept change-review.

${diffSource}

Wenn das Agent-Tool und der Agent-Typ change-review verfügbar sind, starte genau einen
change-review im Foreground (run_in_background: false). Übergib ihm den aktuellen
Projekt- und Worktree-Kontext sowie die obige Diff-Quelle vollständig. Warte auf seinen
Bericht und zeige ihn unverändert als Ergebnis des Reviews.

Falls das Agent-Tool oder change-review nicht verfügbar ist, führe denselben Auftrag
read-only inline aus: Lade per get_overview die Projekt-Description und sämtliche
cross_cutting Specs, ermittle die vom Diff betroffenen Stories über specs_for_path, lies
deren vollständige Bäume mit get_tree(full=true) und prüfe ihre Architektur-Specs gegen
den Diff. Berichte Architekturabweichungen, Schichtverletzungen und Cross-Cutting-Verstöße
nur mit konkretem Diff- und Spec-Beleg. Ändere weder Dateien noch Trellis-Specs.`;
}
