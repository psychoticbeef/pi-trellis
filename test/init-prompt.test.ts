import { describe, expect, it } from "vitest";
import { INTERVIEW_PROMPT } from "../src/init-prompt.js";

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
