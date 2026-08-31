import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_RECIPES, ensureAgentRecipes } from "../src/agent-recipes.js";
import { CHECK_PROMPT } from "../src/check-prompt.js";
import { createTrellisExtension } from "../src/index.js";
import { createPiHarness } from "./harness.js";

describe("AT-6 Subagent-Rezepte, Check und Auto-Load", () => {
  it("AT-6 UT-23 erfüllt globale Provisionierung, definierte Rollen, Check-Fallback und Auto-Load", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-trellis-at6-"));
    const agentDir = await mkdtemp(join(tmpdir(), "pi-trellis-at6-agent-"));
    const projectAgents = join(cwd, ".pi", "agents");
    const globalAgents = join(agentDir, "agents");
    const preserved = "custom spec checker\n";
    await writeFile(join(cwd, "AGENTS.md"), "trellis-project: project-6\n");
    await mkdir(projectAgents, { recursive: true });
    await writeFile(join(projectAgents, "spec-sync-check.md"), preserved);

    const harness = createPiHarness();
    createTrellisExtension({
      getOverview: async () => ({}),
      ensureAgentRecipes: (project) => ensureAgentRecipes(project, { PI_CODING_AGENT_DIR: agentDir }),
    })(harness.api);
    await harness.commands.get("trellis:on")!("", harness.context(cwd));

    expect(await readFile(join(projectAgents, "spec-sync-check.md"), "utf8")).toBe(preserved);
    for (const name of ["glossary-warden.md", "pre-finish-review.md", "change-review.md", "relic-hunter.md"] as const) {
      expect(await readFile(join(globalAgents, name), "utf8")).toBe(AGENT_RECIPES[name]);
    }
    expect(AGENT_RECIPES["spec-sync-check.md"]).toContain("Vorschlagsliste");
    expect(AGENT_RECIPES["glossary-warden.md"]).toContain("Terminologie-Drift");
    expect(AGENT_RECIPES["pre-finish-review.md"]).toContain("Checkliste");
    expect(AGENT_RECIPES["change-review.md"]).toContain("Architektur-Specs");
    expect(AGENT_RECIPES["relic-hunter.md"]).toContain("Code UND Spec");

    await harness.commands.get("trellis:check")!("", harness.context(cwd));
    expect(harness.userMessages).toEqual([CHECK_PROMPT]);
    expect(CHECK_PROMPT).toMatch(/Agent-Tool[\s\S]*relic-hunter[\s\S]*parallel[\s\S]*inline/);
  });
});
