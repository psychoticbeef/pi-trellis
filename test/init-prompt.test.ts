import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { INTERVIEW_PROMPT } from "../src/init-prompt.js";

function expectInOrder(text: string, fragments: string[]): void {
  let cursor = -1;
  for (const fragment of fragments) {
    const next = text.indexOf(fragment, cursor + 1);
    expect(next, `${JSON.stringify(fragment)} fehlt nach Position ${cursor}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

describe("UT-9 Längenlimit und Pflichtbausteine des Interview-Prompts", () => {
  it("UT-9 bleibt unter 2500 Zeichen", () => {
    expect(INTERVIEW_PROMPT.length).toBeLessThan(2_500);
  });

  it("UT-9 enthält den bestätigungsgebundenen Interview-Ablauf", () => {
    for (const required of [
      "set_description",
      "2–3",
      "Given",
      "When",
      "Then",
      "ausdrücklich bestätigt",
      "cross_cutting",
      "define_term",
      "get_tree",
      "approve_tree",
      "transition",
      "refine",
    ]) {
      expect(INTERVIEW_PROMPT).toContain(required);
    }
    expect(INTERVIEW_PROMPT).toContain("Niemals eine Story vor ihrer Bestätigung anlegen");
  });
});

describe("UT-45 bestätigungsgebundener story map-Ja-Zweig", () => {
  it("UT-45 fragt einmal und setzt Backbone, Aktivitäten und Stories in Reihenfolge", () => {
    expect(INTERVIEW_PROMPT.match(/mehrere user activities/gi)).toHaveLength(1);
    expectInOrder(INTERVIEW_PROMPT, [
      "set_description",
      "Nach bestätigter Beschreibung genau einmal",
      "Backbone vorschlagen",
      "bestätigen",
      "Aktivitäten in dieser Reihenfolge",
      "create_node kind=activity",
      "walking skeleton über alle Aktivitäten",
      "je activity, slice",
      "Gesamte Liste bestätigen",
      "bevor irgendein create_node kind=story",
      "add_acceptance_criterion",
      "Weiter bei 3. Querschnittsthemen",
      "Nein:",
      "2. Erste Features",
    ]);
  });
});

describe("UT-46 unveränderter Nein-Zweig", () => {
  it("UT-46 nennt Retrofit einmal und erhält bisherigen Feature-Fluss byte-identisch", () => {
    expect(INTERVIEW_PROMPT.match(/Eine story map kann später ergänzt werden\./g)).toHaveLength(1);
    expect(INTERVIEW_PROMPT).toContain("Weiter: 2. Erste Features.");

    const existingFlow = INTERVIEW_PROMPT.slice(INTERVIEW_PROMPT.lastIndexOf("2. Erste Features"));
    expect(createHash("sha256").update(existingFlow).digest("hex"))
      .toBe("4e46ee4c127b2da622b6ce62f1376bac2f570b2c1ab27bec418717522a42cd46");
  });
});
