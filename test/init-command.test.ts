import { describe, expect, it } from "vitest";
import { INTERVIEW_PROMPT } from "../src/init-prompt.js";
import { createTrellisExtension } from "../src/index.js";
import { createPiHarness } from "./harness.js";

describe("UT-10 Guard und Nachrichtenversand des init-Commands", () => {
  it("UT-10 registriert trellis:init und weist ohne Trellis-Modus konkret auf trellis:on hin", async () => {
    const harness = createPiHarness();
    createTrellisExtension()(harness.api);

    expect(harness.commands.has("trellis:init")).toBe(true);
    await harness.commands.get("trellis:init")!("", harness.context("/repo"));

    expect(harness.userMessages).toHaveLength(0);
    expect(harness.messages.at(-1)?.content).toContain("aktiven Trellis-Modus");
    expect(harness.messages.at(-1)?.content).toContain("/trellis:on");
  });

  it("UT-10 sendet nach Aktivierung exakt einen Interview-Prompt", async () => {
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-5\n",
      getOverview: async () => ({}),
    })(harness.api);

    await harness.commands.get("trellis:on")!("", harness.context("/repo"));
    await harness.commands.get("trellis:init")!("", harness.context("/repo"));

    expect(harness.userMessages).toEqual([INTERVIEW_PROMPT]);
  });
});
