import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_RECIPES } from "../src/agent-recipes.js";
import { CHECK_PROMPT } from "../src/check-prompt.js";
import { createTrellisExtension } from "../src/index.js";
import { createPiHarness } from "./harness.js";

describe("AT-6 Subagent-Rezepte, Check und Auto-Load", () => {
  it("AT-6 erfüllt create-if-absent, definierte Rollen, Check-Fallback und Auto-Load", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-trellis-at6-"));
    const agents = join(cwd, ".pi", "agents");
    const preserved = "custom spec checker\n";
    await writeFile(join(cwd, "AGENTS.md"), "trellis-project: project-6\n");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(agents, { recursive: true }));
    await writeFile(join(agents, "spec-sync-check.md"), preserved);

    const harness = createPiHarness();
    createTrellisExtension({ getOverview: async () => ({}) })(harness.api);
    await harness.commands.get("trellis:on")!("", harness.context(cwd));

    expect(await readFile(join(agents, "spec-sync-check.md"), "utf8")).toBe(preserved);
    expect(await readFile(join(agents, "glossary-warden.md"), "utf8"))
      .toBe(AGENT_RECIPES["glossary-warden.md"]);
    expect(await readFile(join(agents, "pre-finish-review.md"), "utf8"))
      .toBe(AGENT_RECIPES["pre-finish-review.md"]);
    expect(AGENT_RECIPES["spec-sync-check.md"]).toContain("Vorschlagsliste");
    expect(AGENT_RECIPES["glossary-warden.md"]).toContain("Terminologie-Drift");
    expect(AGENT_RECIPES["pre-finish-review.md"]).toContain("Checkliste");

    await harness.commands.get("trellis:check")!("", harness.context(cwd));
    expect(harness.userMessages).toEqual([CHECK_PROMPT]);
    expect(CHECK_PROMPT).toMatch(/Agent-Tool[\s\S]*parallel[\s\S]*inline/);

  });
});
