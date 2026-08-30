import { describe, expect, it } from "vitest";
import { createTrellisExtension } from "../src/index.js";
import { createPiHarness } from "./harness.js";

describe("AT-2 UI-Status und Statusline Acceptance", () => {
  it("AT-2 erfüllt UI-only Summary, Leerzustand, Statusline-Fehler und Off", async () => {
    let calls = 0;
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-2\n",
      getOverview: async () => {
        calls += 1;
        if (calls === 3) return {
          stories: [{ id: "US-2", title: "Status", status: "in_progress", gates_open: false }],
          stale_nodes: [{ id: "DD-3", title: "stale" }],
        };
        if (calls === 4) throw new Error("offline");
        return {
          stories: [{ id: "US-2", title: "Status", status: "in_progress", gates_open: true }],
          stale_nodes: [{ id: "DD-3", title: "stale" }],
        };
      },
    })(harness.api);
    const context = harness.context("/repo");

    await harness.commands.get("trellis:status")!("", context);
    const summary = harness.notifications.at(-1)?.message ?? "";
    for (const text of ["Kanban |", "in_progress |", "worktree=", "stale |", "blocked_gates | none"]) {
      expect(summary).toContain(text);
    }
    expect(harness.messages).toHaveLength(0);
    expect(harness.userMessages).toHaveLength(0);

    await harness.commands.get("trellis:on")!("", context);
    expect(harness.statuses.at(-1)?.value).toBe("trellis: US-2 | gates open");
    await harness.turnEnd()({ turnIndex: 0 }, context);
    expect(harness.statuses.at(-1)?.value).toBe("trellis: US-2 | gates blocked");
    await harness.turnEnd()({ turnIndex: 1 }, context);
    expect(harness.statuses.at(-1)?.value).toBe("trellis: unreachable");
    await harness.commands.get("trellis:off")!("", context);
    expect(harness.statuses.at(-1)?.value).toBeUndefined();
    await harness.turnEnd()({ turnIndex: 2 }, context);
    expect(calls).toBe(4);

    const empty = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-2\n",
      getOverview: async () => ({}),
    })(empty.api);
    await empty.commands.get("trellis:status")!("", empty.context("/repo"));
    expect(empty.notifications[0].message).toContain("todo=0 | refined=0 | in_progress=0 | done=0");
    expect(empty.notifications[0].message).toContain("in_progress | none");

    const failing = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-2\n",
      getOverview: async () => { throw new Error("MCP unreachable"); },
    })(failing.api);
    await failing.commands.get("trellis:status")!("", failing.context("/repo"));
    expect(failing.notifications).toEqual([{ message: "Trellis-Status nicht verfügbar: MCP unreachable", level: "error" }]);
    expect(failing.messages).toHaveLength(0);
    expect(failing.userMessages).toHaveLength(0);
  });
});
