import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INTERVIEW_PROMPT } from "../src/init-prompt.js";
import { createTrellisExtension } from "../src/index.js";
import { createPiHarness } from "./harness.js";

describe("IT-5 Aktivierung und init-Command im Pi-Harness", () => {
  it("IT-5 sendet den Interview-Prompt ausschließlich nach erfolgreicher Aktivierung", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-trellis-it5-"));
    await writeFile(join(root, "AGENTS.md"), "trellis-project: project-5\n", "utf8");
    const requestedProjects: string[] = [];
    const harness = createPiHarness();
    createTrellisExtension({
      getOverview: async (projectId) => {
        requestedProjects.push(projectId);
        return { description: "Integration" };
      },
    })(harness.api);

    await harness.commands.get("trellis:init")!("", harness.context(root));
    expect(harness.userMessages).toHaveLength(0);

    await harness.commands.get("trellis:on")!("", harness.context(root));
    await harness.commands.get("trellis:init")!("", harness.context(root));

    expect(requestedProjects).toEqual(["project-5"]);
    expect(harness.userMessages).toEqual([INTERVIEW_PROMPT]);
  });
});
