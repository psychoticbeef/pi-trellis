import { describe, expect, it } from "vitest";
import { addWorktreePaths } from "../src/context.js";
import { createTrellisExtension } from "../src/index.js";
import { formatKanbanStatus, MAX_STATUS_SUMMARY_LENGTH } from "../src/status.js";
import { createPiHarness } from "./harness.js";

describe("UT-3 Statusformat und UI-only Command", () => {
  it("UT-3 formatiert Zähler, Worktree, stale Nodes und blockierte Gates", () => {
    const overview = addWorktreePaths({
      stories: [
        { id: "US-1", title: "Done", status: "done", gates_open: true },
        { id: "US-2", title: "Active", status: "in_progress", gates_open: false },
        { id: "US-3", title: "Todo", status: "todo", gates_open: false },
      ],
      stale_nodes: [{ id: "DD-7", kind: "detail_design", title: "Alt" }],
    }, "/repo");
    const status = formatKanbanStatus(overview);

    expect(status).toContain("todo=1 | refined=0 | in_progress=1 | done=1");
    expect(status).toContain("US-2 Active worktree=/repo/.trellis-worktrees/US-2");
    expect(status).toContain("stale | DD-7 detail_design Alt");
    expect(status).toContain("blocked_gates | US-2 Active; US-3 Todo");
  });

  it("UT-3 stellt leere Bereiche mit Null und none dar", () => {
    const status = formatKanbanStatus({});
    expect(status).toContain("todo=0 | refined=0 | in_progress=0 | done=0");
    expect(status).toContain("in_progress | none");
    expect(status).toContain("stale | none");
    expect(status).toContain("blocked_gates | none");
  });

  it("UT-3 begrenzt große Zusammenfassungen deterministisch", () => {
    const huge = "x".repeat(5_000);
    const overview = {
      stories: Array.from({ length: 100 }, (_, index) => ({
        id: `US-${index}`,
        title: huge,
        status: index % 2 ? "in_progress" : "todo",
        gates_open: false,
        worktree_path: `/tmp/${huge}`,
      })),
      stale_nodes: Array.from({ length: 100 }, (_, index) => ({ id: `DD-${index}`, title: huge })),
    };
    const first = formatKanbanStatus(overview);
    expect(first).toBe(formatKanbanStatus(overview));
    expect(first.length).toBeLessThanOrEqual(MAX_STATUS_SUMMARY_LENGTH);
    expect(first).toContain("…(+");
  });

  it("UT-3 gibt Status und Fehler nur über ctx.ui.notify aus", async () => {
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-2\n",
      getOverview: async () => ({ stories: [{ id: "US-2", status: "in_progress", gates_open: true }] }),
    })(harness.api);

    await harness.commands.get("trellis:status")!("", harness.context("/repo"));
    expect(harness.notifications).toHaveLength(1);
    expect(harness.notifications[0]).toMatchObject({ level: "info" });
    expect(harness.notifications[0].message).toContain("Kanban |");
    expect(harness.messages).toHaveLength(0);
    expect(harness.userMessages).toHaveLength(0);

    const failing = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-2\n",
      getOverview: async () => { throw new Error("offline"); },
    })(failing.api);
    await failing.commands.get("trellis:status")!("", failing.context("/repo"));
    expect(failing.notifications).toEqual([{ message: "Trellis-Status nicht verfügbar: offline", level: "error" }]);
    expect(failing.messages).toHaveLength(0);
    expect(failing.userMessages).toHaveLength(0);
  });
});
