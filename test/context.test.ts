import { describe, expect, it } from "vitest";
import { addWorktreePaths, formatTrellisContext, MAX_CONTEXT_LENGTH } from "../src/context.js";
import { createTrellisExtension } from "../src/index.js";
import { createPiHarness } from "./harness.js";

describe("UT-2 Trellis-Kontextblock und Off-Grundlagen", () => {
  it("UT-2 enthält alle Pflichtabschnitte und Kanban-Zähler", () => {
    const overview = addWorktreePaths({
      description: "Projektbeschreibung",
      glossary: [{ term: "Trellis-Modus", definition: "aktiv" }],
      stories: [
        { id: "US-1", title: "Aktiv", status: "in_progress" },
        { id: "US-2", title: "Fertig", status: "done" },
      ],
      stale_nodes: [{ id: "DD-9", kind: "detail_design", title: "Alt" }],
    }, "/repo");
    const block = formatTrellisContext(overview);

    expect(block).toContain("Description: Projektbeschreibung");
    expect(block).toContain("Glossar: Trellis-Modus=aktiv");
    expect(block).toContain("todo=0 refined=0 in_progress=1 done=1");
    expect(block).toContain("in_progress: US-1 Aktiv worktree=/repo/.trellis-worktrees/US-1");
    expect(block).toContain("stale: DD-9 detail_design Alt");
    expect(block.length).toBeLessThan(MAX_CONTEXT_LENGTH);
  });

  it("UT-2 bleibt mit extrem großen Daten deterministisch unter 1500 Zeichen", () => {
    const huge = "x".repeat(10_000);
    const overview = {
      description: huge,
      glossary: Array.from({ length: 100 }, (_, index) => ({ term: `term-${index}`, definition: huge })),
      stories: Array.from({ length: 100 }, (_, index) => ({
        id: `US-${index}`,
        title: huge,
        status: index === 0 ? "in_progress" : "todo",
        worktree_path: `/tmp/${huge}`,
      })),
      stale_nodes: Array.from({ length: 100 }, (_, index) => ({ id: `DD-${index}`, title: huge })),
    };
    const first = formatTrellisContext(overview);
    const second = formatTrellisContext(overview);

    expect(first).toBe(second);
    expect(first.length).toBeLessThan(1500);
    for (const heading of ["Description:", "Glossar:", "Kanban:", "in_progress:", "stale:"]) {
      expect(first).toContain(heading);
    }
    expect(first).toContain("…(+");
  });

  it("UT-2 bildet leere Overview-Felder explizit ab", () => {
    const block = formatTrellisContext({});
    expect(block).toContain("Description: -");
    expect(block).toContain("Glossar: none");
    expect(block).toContain("in_progress: none");
    expect(block).toContain("stale: none");
  });

  it("UT-2 fragt pro aktivem User-Turn frisch ab und nach Off nicht mehr", async () => {
    let calls = 0;
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-1\n",
      getOverview: async () => {
        calls += 1;
        return { description: `call-${calls}` };
      },
    })(harness.api);
    const context = harness.context("/project");

    await harness.commands.get("trellis:on")!("", context);
    const first = await harness.beforeAgentStart()({ systemPrompt: "base" }, context);
    const second = await harness.beforeAgentStart()({ systemPrompt: "base" }, context);
    expect(first?.systemPrompt).toContain("Description: call-2");
    expect(second?.systemPrompt).toContain("Description: call-3");

    await harness.commands.get("trellis:off")!("", context);
    await expect(harness.beforeAgentStart()({ systemPrompt: "base" }, context)).resolves.toBeUndefined();
    expect(calls).toBe(3);
  });

  it("UT-2 injiziert bei Refresh-Fehlern keinen veralteten Overview", async () => {
    let calls = 0;
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-1\n",
      getOverview: async () => {
        calls += 1;
        if (calls > 1) throw new Error("offline");
        return { description: "old data", stories: [{ id: "US-1", status: "in_progress" }] };
      },
    })(harness.api);
    const context = harness.context("/project");
    await harness.commands.get("trellis:on")!("", context);

    const result = await harness.beforeAgentStart()({ systemPrompt: "base" }, context);
    expect(result?.systemPrompt).toContain("Description: unavailable: offline");
    expect(result?.systemPrompt).not.toContain("old data");
  });

  it("UT-2 verwirft eine laufende Injektion wenn Off dazwischen ausgeführt wird", async () => {
    let resolveRefresh: ((value: { description: string }) => void) | undefined;
    let calls = 0;
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-1\n",
      getOverview: async () => {
        calls += 1;
        if (calls === 1) return { description: "activation" };
        return new Promise((resolve) => { resolveRefresh = resolve; });
      },
    })(harness.api);
    const context = harness.context("/project");
    await harness.commands.get("trellis:on")!("", context);

    const pending = harness.beforeAgentStart()({ systemPrompt: "base" }, context);
    await harness.commands.get("trellis:off")!("", context);
    resolveRefresh!({ description: "late" });
    await expect(pending).resolves.toBeUndefined();
  });
});
