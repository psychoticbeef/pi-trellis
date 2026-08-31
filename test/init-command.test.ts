import { describe, expect, it } from "vitest";
import { INTERVIEW_PROMPT } from "../src/init-prompt.js";
import { createTrellisExtension } from "../src/index.js";
import { ONBOARDING_INTERVIEW_PROMPT } from "../src/onboarding-prompt.js";
import { createPiHarness } from "./harness.js";

function missingFile(): NodeJS.ErrnoException {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

describe("UT-10 UT-26 Zustandsabhängiger init-Command", () => {
  it("UT-10 UT-26 registriert trellis:init und startet ohne Verdrahtung das Onboarding", async () => {
    const harness = createPiHarness();
    createTrellisExtension({ readTextFile: async () => Promise.reject(missingFile()) })(harness.api);

    expect(harness.commands.has("trellis:init")).toBe(true);
    await harness.commands.get("trellis:init")!("", harness.context("/repo"));

    expect(harness.userMessages).toEqual([ONBOARDING_INTERVIEW_PROMPT]);
    expect(harness.messages).toHaveLength(0);
  });

  it("UT-10 UT-26 sendet mit gültiger Verdrahtung ohne Aktivierungsumweg den Interview-Prompt", async () => {
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-5\n",
      getOverview: async () => ({}),
    })(harness.api);

    await harness.commands.get("trellis:init")!("", harness.context("/repo"));

    expect(harness.userMessages).toEqual([INTERVIEW_PROMPT]);
  });

  it("UT-26 behandelt eine ungültige trellis-project-Konfiguration als Onboarding-Fall", async () => {
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: first\ntrellis-project: second\n",
    })(harness.api);

    await harness.commands.get("trellis:init")!("", harness.context("/repo"));

    expect(harness.userMessages).toEqual([ONBOARDING_INTERVIEW_PROMPT]);
  });
});
