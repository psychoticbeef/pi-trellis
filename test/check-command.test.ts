import { describe, expect, it } from "vitest";
import { CHECK_PROMPT } from "../src/check-prompt.js";
import { createTrellisExtension } from "../src/index.js";
import { createPiHarness } from "./harness.js";

describe("UT-12 Check-Prompt und Command-Guard", () => {
  it("UT-12 beschreibt parallele Agent-Spawns und den vollständigen Inline-Fallback", () => {
    for (const required of [
      "Agent-Tool",
      "spec-sync-check",
      "glossary-warden",
      "parallel",
      "specs_for_path",
      "Done-Bäume",
      "get_tree(full=true)",
      "Glossar",
      "get_overview",
      "inline",
      "Vorschlagsliste",
    ]) expect(CHECK_PROMPT).toContain(required);
  });

  it("UT-12 schützt trellis:check mit dem Trellis-Modus und sendet exakt CHECK_PROMPT", async () => {
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-6\n",
      getOverview: async () => ({}),
      ensureAgentRecipes: async () => undefined,
    })(harness.api);

    expect(harness.commands.has("trellis:check")).toBe(true);
    await harness.commands.get("trellis:check")!("", harness.context("/repo"));
    expect(harness.userMessages).toHaveLength(0);
    expect(harness.messages.at(-1)?.content).toContain("aktiven Trellis-Modus");
    expect(harness.messages.at(-1)?.content).toContain("/trellis:on");

    await harness.commands.get("trellis:on")!("", harness.context("/repo"));
    await harness.commands.get("trellis:check")!("", harness.context("/repo"));
    expect(harness.userMessages).toEqual([CHECK_PROMPT]);
  });
});
