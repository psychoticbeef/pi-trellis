import { describe, expect, it } from "vitest";
import { createTrellisExtension } from "../src/index.js";
import { createPiHarness } from "./harness.js";

describe("AT-5 Geführtes Projekt-Interview über den Slash-Command", () => {
  it("AT-5 erfüllt Modus-Guard, Einzelinjektion, Längenlimit und Interview-Abschluss", async () => {
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-5\n",
      getOverview: async () => ({ description: "Acceptance" }),
    })(harness.api);

    await harness.commands.get("trellis:init")!("", harness.context("/repo"));
    expect(harness.userMessages).toHaveLength(0);
    expect(harness.messages.at(-1)?.content).toContain("/trellis:on");

    await harness.commands.get("trellis:on")!("", harness.context("/repo"));
    await harness.commands.get("trellis:init")!("", harness.context("/repo"));

    expect(harness.userMessages).toHaveLength(1);
    const prompt = harness.userMessages[0];
    expect(typeof prompt).toBe("string");
    expect((prompt as string).length).toBeLessThan(2_500);
    for (const required of [
      "set_description",
      "2–3",
      "Given",
      "When",
      "Then",
      "Bestätigung",
      "cross_cutting",
      "Glossar",
      "approve_tree",
      "refine",
    ]) {
      expect(prompt).toContain(required);
    }
  });
});
