import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTrellisExtension } from "../src/index.js";
import { createPiHarness } from "./harness.js";

describe("AT-1 Trellis-Modus Acceptance", () => {
  it("AT-1 erfüllt Aktivierung, Kontextlimit, Fehlerverhalten und Deaktivierung", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-trellis-at1-"));
    await writeFile(join(root, "AGENTS.md"), "trellis-project: acceptance-project\n", "utf8");
    let overviewCalls = 0;
    const harness = createPiHarness();
    createTrellisExtension({
      environment: {},
      getOverview: async () => {
        overviewCalls += 1;
        return {
          description: "Acceptance description",
          glossary: [{ term: "Board-Adresse", definition: "lokal" }],
          stories: [{ id: "US-1", title: "Acceptance", status: "in_progress" }],
          stale_nodes: [{ id: "DD-1", title: "stale" }],
        };
      },
    })(harness.api);

    await harness.commands.get("trellis:on")!("", harness.context(root));
    expect(harness.messages.at(-1)?.content).toContain("http://127.0.0.1:7420/p/acceptance-project/");
    const result = await harness.beforeAgentStart()({ systemPrompt: "base" }, harness.context(root));
    const block = result!.systemPrompt.slice("base\n\n".length);
    expect(block.length).toBeLessThan(1500);
    for (const text of ["Description:", "Glossar:", "Kanban:", "in_progress:", "worktree=", "stale:"]) {
      expect(block).toContain(text);
    }
    expect(overviewCalls).toBe(2);

    await harness.commands.get("trellis:off")!("", harness.context(root));
    await expect(harness.beforeAgentStart()({ systemPrompt: "base" }, harness.context(root))).resolves.toBeUndefined();
    expect(overviewCalls).toBe(2);

    const noProjectRoot = await mkdtemp(join(tmpdir(), "pi-trellis-at1-missing-"));
    const missingHarness = createPiHarness();
    createTrellisExtension({ getOverview: async () => ({}) })(missingHarness.api);
    await missingHarness.commands.get("trellis:on")!("", missingHarness.context(noProjectRoot));
    expect(missingHarness.messages.at(-1)?.content).toMatch(/nicht aktiviert.*Keine gültige trellis-project-Angabe/);
    expect(missingHarness.messages.at(-1)?.content).not.toContain("/p/");

    const failingHarness = createPiHarness();
    createTrellisExtension({ getOverview: async () => { throw new Error("MCP nicht erreichbar"); } })(failingHarness.api);
    await failingHarness.commands.get("trellis:on")!("", failingHarness.context(root));
    expect(failingHarness.messages.at(-1)?.content).toBe("Trellis-Modus nicht aktiviert: MCP nicht erreichbar");
    expect(failingHarness.messages.at(-1)?.content).not.toContain("/p/");
  });
});
