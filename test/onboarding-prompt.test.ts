import { describe, expect, it } from "vitest";
import { INTERVIEW_PROMPT } from "../src/init-prompt.js";
import { ONBOARDING_INTERVIEW_PROMPT, ONBOARDING_PROMPT } from "../src/onboarding-prompt.js";

function expectInOrder(text: string, fragments: string[]): void {
  let cursor = -1;
  for (const fragment of fragments) {
    const next = text.indexOf(fragment, cursor + 1);
    expect(next, `${JSON.stringify(fragment)} fehlt nach Position ${cursor}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

describe("UT-27 Sicherer Onboarding-Prompt und Gate-Rezepte", () => {
  it("UT-27 erzwingt Inspektion, sichere Skeleton-Erstellung und Vorab-Commit in Reihenfolge", () => {
    expectInOrder(ONBOARDING_PROMPT, [
      "Repository verstehen",
      "Zweck, Sprache und Stack",
      "Skeleton sicher vorbereiten",
      "git init -b develop",
      "ausschließlich fehlende Dateien",
      "Zwingender Vorab-Commit",
      "Committe danach ALLE",
      "bevor du trellis init ausführst",
      "trellis init --name <name> --repo <absoluter-repo-pfad>",
      "trellis config",
      "trellis doctor <project-id>",
    ]);
    expect(ONBOARDING_PROMPT).toContain("überschreibe, ersetze oder lösche niemals vorhandene Dateien");
    expect(ONBOARDING_PROMPT).toContain("Branch-Gate-Hook");
    expect(ONBOARDING_PROMPT).toContain("Versuche nach trellis init keinen direkten Commit auf develop");
  });

  it("UT-27 enthält die exakten TypeScript-, Go- und Python-Gate-Rezepte", () => {
    for (const required of [
      "npx tsc --noEmit",
      "npx vitest run --reporter=junit --outputFile=reports/tests.xml --coverage.enabled --coverage.reporter=lcov --coverage.reportsDirectory=reports/coverage",
      "reports/coverage/lcov.info",
      "go vet ./...",
      "gotestsum --junitfile reports/tests.xml -- -coverprofile=reports/coverage.out ./...",
      "ruff check",
      "pytest --junitxml=reports/tests.xml --cov --cov-report=lcov:reports/lcov.info",
      "JUnit-XML",
      "LCOV oder Go-coverprofile",
    ]) expect(ONBOARDING_PROMPT).toContain(required);
  });

  it("UT-27 hält Gate-Konfiguration in der Shell-CLI und geht nahtlos ins Interview über", () => {
    expect(ONBOARDING_PROMPT).toMatch(/trellis config[\s\S]*Shell-CLI[\s\S]*niemals über MCP/);
    expect(ONBOARDING_PROMPT).toContain("trellis doctor");
    expect(ONBOARDING_INTERVIEW_PROMPT.endsWith(INTERVIEW_PROMPT)).toBe(true);
    expect(ONBOARDING_INTERVIEW_PROMPT.match(/Du führst mit dem User ein strukturiertes Trellis-Projekt-Interview/g))
      .toHaveLength(1);
  });
});
