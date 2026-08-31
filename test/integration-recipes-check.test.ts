import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_RECIPES, ensureAgentRecipes } from "../src/agent-recipes.js";
import { CHECK_PROMPT } from "../src/check-prompt.js";
import { createTrellisExtension } from "../src/index.js";
import { createPiHarness } from "./harness.js";

describe("IT-6 IT-11 Aktivierung, globale Provisionierung und Check im pi-Harness", () => {
  it("IT-6 IT-11 verbindet Aktivierung, globales create-if-absent und Check-Prompt", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-trellis-it11-project-"));
    const agentDir = await mkdtemp(join(tmpdir(), "pi-trellis-it11-agent-"));
    const projectAgents = join(cwd, ".pi", "agents");
    const globalAgents = join(agentDir, "agents");
    await writeFile(join(cwd, "AGENTS.md"), "trellis-project: project-6\n");
    await mkdir(projectAgents, { recursive: true });
    await writeFile(join(projectAgents, "glossary-warden.md"), "keep\n");

    const harness = createPiHarness();
    createTrellisExtension({
      getOverview: async () => ({}),
      ensureAgentRecipes: (project) => ensureAgentRecipes(project, { PI_CODING_AGENT_DIR: agentDir }),
    })(harness.api);
    await harness.commands.get("trellis:on")!("", harness.context(cwd));

    expect(await readFile(join(projectAgents, "glossary-warden.md"), "utf8")).toBe("keep\n");
    for (const name of ["spec-sync-check.md", "pre-finish-review.md", "change-review.md", "relic-hunter.md"] as const) {
      expect(await readFile(join(globalAgents, name), "utf8")).toBe(AGENT_RECIPES[name]);
      await expect(access(join(projectAgents, name))).rejects.toMatchObject({ code: "ENOENT" });
    }

    await harness.commands.get("trellis:check")!("", harness.context(cwd));
    expect(harness.userMessages).toEqual([CHECK_PROMPT]);
    expect(CHECK_PROMPT).toContain("relic-hunter");
  });
});
