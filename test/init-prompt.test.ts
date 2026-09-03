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
      "Nach Beschreibung-Bestätigung einmal",
      "Backbone vorschlagen/bestätigen",
      "geordnete user activities",
      "create_node kind=activity",
      "Jede neue activity: get_node",
      "approve mit dessen content_hash",
      "danach erst placement",
      "walking skeleton über alle user activities",
      "je activity, slice",
      "Liste vor create_node kind=story bestätigen",
      "add_acceptance_criterion",
      "Dann 3.",
      "Nein:",
      "2. Erste Features",
    ]);
  });
});

describe("UT-49 Interview-Reihenfolge, Hash-Weitergabe und Einmal-Retry", () => {
  it("UT-49 approvt jede neue activity vor erster placement-Mutation", () => {
    expectInOrder(INTERVIEW_PROMPT, [
      "create_node kind=activity",
      "Jede neue activity: get_node",
      "approve mit dessen content_hash",
      "danach erst placement via set_map_position/create_node",
    ]);
  });

  it("UT-49 repariert benannte unapproved oder stale activity und retried einmal", () => {
    expect(INTERVIEW_PROMPT).toMatch(
      /Benannte unapproved\/stale activity:[\s\S]*get_node[\s\S]*approve mit dessen content_hash[\s\S]*Placement einmal wiederholen, Folgefehler melden; nie blind/,
    );
  });
});

describe("UT-46 unveränderter Nein-Zweig", () => {
  it("UT-46 nennt Retrofit einmal und erhält bisherigen Feature-Fluss byte-identisch", () => {
    expect(INTERVIEW_PROMPT.match(/Eine story map kann später ergänzt werden\./g)).toHaveLength(1);
    expect(INTERVIEW_PROMPT).toContain("Dann 2. Erste Features.");

    const existingFlow = INTERVIEW_PROMPT.slice(INTERVIEW_PROMPT.lastIndexOf("2. Erste Features"));
    expect(createHash("sha256").update(existingFlow).digest("hex"))
      .toBe("4e46ee4c127b2da622b6ce62f1376bac2f570b2c1ab27bec418717522a42cd46");
  });
});
