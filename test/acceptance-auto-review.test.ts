import { describe, expect, it } from "vitest";
import type { TrellisOverview } from "../src/context.js";
import { createTrellisExtension } from "../src/index.js";
import { REVIEWERS } from "../src/review-gate.js";
import { createPiHarness } from "./harness.js";

const overview: TrellisOverview = {
  description: "Auto activation",
  stories: [{ id: "US-9", title: "Feature", status: "in_progress", gates_open: true }],
};

describe("AT-12 IT-9 Automatischer Sitzungsstart und Review-Gate-Reset", () => {
  it("AT-12 IT-9 erfüllt Auto-Aktivierung, sticky Off, Review-Anweisung, Re-Call und Story-Isolation", async () => {
    let overviewCalls = 0;
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: auto-project\n",
      environment: { TRELLIS_BOARD_ADDRESS: "http://board.test:9000" },
      getOverview: async () => {
        overviewCalls += 1;
        return overview;
      },
      ensureAgentRecipes: async () => undefined,
    })(harness.api);
    const context = harness.context("/repo");

    await harness.sessionStart()({ reason: "startup" }, context);
    expect(overviewCalls).toBe(1);
    expect(harness.statuses.at(-1)).toEqual({ key: "trellis", value: "trellis: US-9 | gates open" });
    expect(harness.messages.at(-1)?.content)
      .toBe("Trellis-Modus aktiviert: http://board.test:9000/p/auto-project/");

    const finish = {
      toolCallId: "finish-1",
      toolName: "mcp",
      input: {
        server: "trellis",
        tool: "transition",
        args: { story_id: "US-9", action: "finish" },
      },
    };
    const first = await harness.toolCall()(finish, context) as { block: boolean; reason: string };
    expect(first.block).toBe(true);
    for (const text of [...REVIEWERS, "Agent-Tool", "parallel", "read-only"]) {
      expect(first.reason).toContain(text);
    }
    for (const [index, reviewer] of REVIEWERS.entries()) {
      const review = {
        toolCallId: `review-${index}`,
        toolName: "Agent",
        input: { subagent_type: reviewer, run_in_background: true },
      };
      await harness.toolCall()(review, context);
      await harness.toolResult()({ ...review, isError: false }, context);
    }
    await expect(harness.toolCall()({ ...finish, toolCallId: "finish-2" }, context))
      .resolves.toBeUndefined();
    await expect(harness.toolCall()({
      ...finish,
      toolCallId: "start",
      input: { ...finish.input, args: { story_id: "US-9", action: "start" } },
    }, context)).resolves.toBeUndefined();
    await expect(harness.toolCall()({
      ...finish,
      toolCallId: "other-story",
      input: { ...finish.input, args: { story_id: "US-10", action: "finish" } },
    }, context)).resolves.toMatchObject({ block: true });

    await harness.commands.get("trellis:off")!("", context);
    await harness.commands.get("trellis:on")!("", context);
    expect(overviewCalls).toBe(1);
    expect(harness.statuses.at(-1)).toEqual({ key: "trellis", value: undefined });
    expect(harness.messages.at(-1)?.content)
      .toBe("Trellis-Modus bleibt bis zum Sitzungsende deaktiviert.");

    await harness.sessionStart()({ reason: "new" }, context);
    expect(overviewCalls).toBe(2);
    expect(harness.messages.at(-1)?.content)
      .toBe("Trellis-Modus aktiviert: http://board.test:9000/p/auto-project/");
    await expect(harness.toolCall()({ ...finish, toolCallId: "finish-new-session" }, context))
      .resolves.toMatchObject({ block: true });
  });
});

describe("UT-19 Auto-Aktivierung, Off-Race und Sitzungsreset", () => {
  it("UT-19 bleibt ohne gültige trellis-project-Zeile still", async () => {
    let overviewCalls = 0;
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
      getOverview: async () => {
        overviewCalls += 1;
        return overview;
      },
    })(harness.api);

    await harness.sessionStart()({ reason: "startup" }, harness.context("/repo"));
    expect(overviewCalls).toBe(0);
    expect(harness.messages).toEqual([]);
  });

  it("UT-19 lässt /trellis:off eine laufende Auto-Aktivierung entwerten", async () => {
    let resolveOverview: ((value: TrellisOverview) => void) | undefined;
    let overviewCalls = 0;
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: auto-project\n",
      getOverview: async () => {
        overviewCalls += 1;
        if (overviewCalls === 1) {
          return new Promise((resolve) => { resolveOverview = resolve; });
        }
        return overview;
      },
      ensureAgentRecipes: async () => undefined,
    })(harness.api);
    const context = harness.context("/repo");

    const pendingStart = harness.sessionStart()({ reason: "startup" }, context);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await harness.commands.get("trellis:off")!("", context);
    resolveOverview!(overview);
    await pendingStart;
    expect(harness.messages.map((message) => message.content)).toEqual([
      "Trellis-Modus deaktiviert.",
    ]);

    await harness.commands.get("trellis:on")!("", context);
    expect(overviewCalls).toBe(1);
    expect(harness.messages.at(-1)?.content)
      .toBe("Trellis-Modus bleibt bis zum Sitzungsende deaktiviert.");

    await harness.sessionStart()({ reason: "new" }, context);
    expect(overviewCalls).toBe(2);
    expect(harness.messages.at(-1)?.content)
      .toContain("Trellis-Modus aktiviert:");
  });
});
