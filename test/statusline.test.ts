import { describe, expect, it } from "vitest";
import type { TrellisOverview } from "../src/context.js";
import { createTrellisExtension } from "../src/index.js";
import { formatStatusLine } from "../src/status.js";
import { createPiHarness } from "./harness.js";

describe("UT-4 Statusline-Aktualisierung und Off-Race", () => {
  it("UT-4 formatiert open, blocked und idle kompakt", () => {
    expect(formatStatusLine({ stories: [] })).toBe("trellis: idle");
    expect(formatStatusLine({ stories: [{ id: "US-2", status: "in_progress", gates_open: true }] }))
      .toBe("trellis: US-2 | gates open");
    expect(formatStatusLine({ stories: [{ id: "US-2", status: "in_progress", gates_open: false }] }))
      .toBe("trellis: US-2 | gates blocked");
  });

  it("UT-4 setzt initial, aktualisiert nach Turn und zeigt unreachable ohne stale Fallback", async () => {
    let calls = 0;
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-2\n",
      getOverview: async () => {
        calls += 1;
        if (calls === 1) return { stories: [{ id: "US-2", status: "in_progress", gates_open: true }] };
        if (calls === 2) return { stories: [{ id: "US-2", status: "in_progress", gates_open: false }] };
        throw new Error("offline");
      },
    })(harness.api);
    const context = harness.context("/repo");

    await harness.commands.get("trellis:on")!("", context);
    expect(harness.statuses.at(-1)).toEqual({ key: "trellis", value: "trellis: US-2 | gates open" });
    await harness.turnEnd()({ turnIndex: 0 }, context);
    expect(harness.statuses.at(-1)).toEqual({ key: "trellis", value: "trellis: US-2 | gates blocked" });
    await harness.turnEnd()({ turnIndex: 1 }, context);
    expect(harness.statuses.at(-1)).toEqual({ key: "trellis", value: "trellis: unreachable" });
  });

  it("UT-4 löscht bei Off und arbeitet danach nicht mehr", async () => {
    let calls = 0;
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-2\n",
      getOverview: async () => {
        calls += 1;
        return { stories: [{ id: "US-2", status: "in_progress", gates_open: true }] };
      },
    })(harness.api);
    const context = harness.context("/repo");

    await harness.commands.get("trellis:on")!("", context);
    await harness.commands.get("trellis:off")!("", context);
    expect(harness.statuses.at(-1)).toEqual({ key: "trellis", value: undefined });
    await harness.turnEnd()({ turnIndex: 0 }, context);
    expect(calls).toBe(1);
    expect(harness.statuses.at(-1)).toEqual({ key: "trellis", value: undefined });
  });

  it("UT-4 entwertet ein verspätetes Turn-Update nach Off", async () => {
    let calls = 0;
    let resolveRefresh: ((value: TrellisOverview) => void) | undefined;
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-2\n",
      getOverview: async () => {
        calls += 1;
        if (calls === 1) return { stories: [{ id: "US-2", status: "in_progress", gates_open: true }] };
        return new Promise((resolve) => { resolveRefresh = resolve; });
      },
    })(harness.api);
    const context = harness.context("/repo");
    await harness.commands.get("trellis:on")!("", context);

    const pending = harness.turnEnd()({ turnIndex: 0 }, context);
    await harness.commands.get("trellis:off")!("", context);
    resolveRefresh!({ stories: [{ id: "US-2", status: "in_progress", gates_open: false }] });
    await pending;
    expect(harness.statuses.at(-1)).toEqual({ key: "trellis", value: undefined });
  });

  it("UT-4 verhindert dass ein laufendes On die Deaktivierung rückgängig macht", async () => {
    let resolveActivation: ((value: TrellisOverview) => void) | undefined;
    let calls = 0;
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-2\n",
      getOverview: async () => {
        calls += 1;
        return new Promise((resolve) => { resolveActivation = resolve; });
      },
    })(harness.api);
    const context = harness.context("/repo");

    const pendingOn = harness.commands.get("trellis:on")!("", context);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await harness.commands.get("trellis:off")!("", context);
    resolveActivation!({ stories: [{ id: "US-2", status: "in_progress", gates_open: true }] });
    await pendingOn;

    expect(harness.statuses.at(-1)).toEqual({ key: "trellis", value: undefined });
    expect(harness.messages.map((message) => message.content)).toEqual(["Trellis-Modus deaktiviert."]);
    await harness.turnEnd()({ turnIndex: 0 }, context);
    expect(calls).toBe(1);
  });

  it("UT-4 lässt bei parallelen Turn-Updates nur das neueste Ergebnis schreiben", async () => {
    const resolvers: Array<(value: TrellisOverview) => void> = [];
    let calls = 0;
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-2\n",
      getOverview: async () => {
        calls += 1;
        if (calls === 1) return { stories: [{ id: "US-2", status: "in_progress", gates_open: true }] };
        return new Promise((resolve) => resolvers.push(resolve));
      },
    })(harness.api);
    const context = harness.context("/repo");
    await harness.commands.get("trellis:on")!("", context);

    const older = harness.turnEnd()({ turnIndex: 0 }, context);
    const newer = harness.turnEnd()({ turnIndex: 1 }, context);
    resolvers[1]({ stories: [{ id: "US-2", status: "in_progress", gates_open: false }] });
    await newer;
    resolvers[0]({ stories: [{ id: "US-2", status: "in_progress", gates_open: true }] });
    await older;

    expect(harness.statuses.at(-1)).toEqual({ key: "trellis", value: "trellis: US-2 | gates blocked" });
  });
});
