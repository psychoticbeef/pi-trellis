import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INTERVIEW_PROMPT } from "../src/init-prompt.js";
import { createTrellisExtension } from "../src/index.js";
import { ONBOARDING_INTERVIEW_PROMPT } from "../src/onboarding-prompt.js";
import { createPiHarness } from "./harness.js";

describe("IT-5 IT-12 Zustandserkennung des init-Commands im pi-Harness", () => {
  it("IT-5 IT-12 wählt für verdrahtete und neue Projekte jeweils genau einen Prompt", async () => {
    const wiredRoot = await mkdtemp(join(tmpdir(), "pi-trellis-it12-wired-"));
    const newRoot = await mkdtemp(join(tmpdir(), "pi-trellis-it12-new-"));
    await writeFile(join(wiredRoot, "AGENTS.md"), "trellis-project: project-12\n", "utf8");

    const harness = createPiHarness();
    createTrellisExtension()(harness.api);

    await harness.commands.get("trellis:init")!("", harness.context(wiredRoot));
    await harness.commands.get("trellis:init")!("", harness.context(newRoot));

    expect(harness.userMessages).toEqual([INTERVIEW_PROMPT, ONBOARDING_INTERVIEW_PROMPT]);
    expect(ONBOARDING_INTERVIEW_PROMPT.endsWith(INTERVIEW_PROMPT)).toBe(true);
  });
});
