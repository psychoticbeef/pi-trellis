import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTrellisExtension } from "../src/index.js";
import { createPiHarness } from "./harness.js";

describe("AT-3 Spec-aware Dateihinweise im Trellis-Modus", () => {
  it("AT-3 erfüllt Done-Hinweise, Sitzungs-Deduplizierung, in_progress-Ausnahme und Unterdrückung", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-trellis-at3-"));
    await writeFile(join(root, "AGENTS.md"), "trellis-project: project-3\n", "utf8");
    const snapshots = new Map<string, string | undefined>();
    const harness = createPiHarness();
    createTrellisExtension({
      getOverview: async () => ({
        stories: [{ id: "US-3", title: "Current", status: "in_progress" }],
        stale_nodes: [],
      }),
      readFileSnapshot: async (path) => snapshots.get(path),
      specsForPath: async (_project, path) => {
        if (path === "a.ts") return { stories: [
          { id: "US-1", title: "Mode", status: "done" },
          { id: "US-3", title: "Current", status: "in_progress" },
        ] };
        if (path === "b.ts") return { stories: [
          { id: "US-1", title: "Mode", status: "done" },
          { id: "US-2", title: "Status", status: "done" },
        ] };
        return { stories: [] };
      },
    })(harness.api);
    const context = harness.context(root);

    const mutate = async (id: string, toolName: "edit" | "write", path: string, value: string, isError = false) => {
      await harness.toolCall()({ toolCallId: id, toolName, input: { path } }, context);
      snapshots.set(join(root, path), value);
      await harness.toolResult()({ toolCallId: id, toolName, input: { path }, isError }, context);
    };

    await mutate("inactive", "write", "a.ts", "inactive");
    await harness.commands.get("trellis:on")!("", context);

    await mutate("first", "edit", "a.ts", "first");
    await mutate("duplicate", "write", "a.ts", "second");
    await mutate("second-story", "write", "b.ts", "first");

    snapshots.set(join(root, "same.ts"), "same");
    await mutate("unchanged", "edit", "same.ts", "same");
    await mutate("failed", "write", "failed.ts", "failed", true);
    await mutate("no-match", "write", "none.ts", "changed");

    await harness.commands.get("trellis:off")!("", context);
    await mutate("off", "write", "b.ts", "after off");

    const hints = harness.messages.filter((message) => message.customType === "trellis-file-hint");
    expect(hints.map((message) => message.content)).toEqual([
      "Datei a.ts betrifft Story US-1 (Mode) – sind deren Specs/Tests noch aktuell?",
      "Datei b.ts betrifft Story US-2 (Status) – sind deren Specs/Tests noch aktuell?",
    ]);
    expect(hints.map((message) => message.options)).toEqual([
      { deliverAs: "nextTurn" },
      { deliverAs: "nextTurn" },
    ]);
    expect(hints.some((message) => message.content.includes("US-3"))).toBe(false);
    expect(harness.userMessages).toHaveLength(0);
  });
});
