import { describe, expect, it } from "vitest";
import { createTrellisExtension } from "../src/index.js";
import {
  finishStoryIdFromToolCall,
  REVIEWERS,
  REVIEW_GATE_INSTRUCTION,
  ReviewGate,
  reviewGateReason,
} from "../src/review-gate.js";
import { createPiHarness } from "./harness.js";

describe("UT-20 finish-Erkennung", () => {
  it("UT-20 erkennt direkte und MCP-Gateway finish-Aufrufe strikt", () => {
    expect(finishStoryIdFromToolCall("trellis_transition", {
      story_id: "US-9",
      action: "finish",
    })).toBe("US-9");
    expect(finishStoryIdFromToolCall("mcp__trellis__transition", {
      story_id: "US-10",
      action: "finish",
    })).toBe("US-10");
    expect(finishStoryIdFromToolCall("mcp", {
      server: "trellis",
      tool: "transition",
      args: { story_id: "US-11", action: "finish" },
    })).toBe("US-11");
    expect(finishStoryIdFromToolCall("mcp", {
      tool: "trellis_transition",
      args: JSON.stringify({ story_id: "US-12", action: "finish" }),
    })).toBe("US-12");
    expect(finishStoryIdFromToolCall("trellis_transition", {
      story_id: "US-9",
      action: "start",
    })).toBeUndefined();
    expect(finishStoryIdFromToolCall("mcp", {
      server: "other",
      tool: "transition",
      args: { story_id: "US-9", action: "finish" },
    })).toBeUndefined();
  });
});

describe("UT-21 Review-Zustand, Instruktion, Isolation und Fail-open", () => {
  it("UT-21 nennt alle Reviewer, Parallelität und jeweils fehlende Reviews", () => {
    const gate = new ReviewGate();
    const first = gate.finish("US-10");
    expect(first.block).toBe(true);
    for (const reviewer of REVIEWERS) {
      expect(REVIEW_GATE_INSTRUCTION).toContain(reviewer);
      expect(first.reason).toContain(reviewer);
    }
    for (const text of ["Agent-Tool", "parallel", "read-only", "finish", "erneut"]) {
      expect(REVIEW_GATE_INSTRUCTION).toContain(text);
    }
    expect(reviewGateReason("US-10", REVIEWERS, 1)).toContain("Fehlend:");
  });

  it("UT-21 blockiert dreimal, kündigt Fail-open an und lässt den vierten Versuch dauerhaft warnend durch", () => {
    const gate = new ReviewGate();
    expect(gate.finish("US-10")).toMatchObject({ block: true });
    expect(gate.finish("US-10")).toMatchObject({ block: true });
    const third = gate.finish("US-10");
    expect(third).toMatchObject({ block: true });
    expect(third.reason).toContain("nächste finish-Aufruf");
    const fourth = gate.finish("US-10");
    expect(fourth.block).toBe(false);
    expect(fourth.warning).toContain("ohne vollständige Review-Nachweise");
    expect(gate.finish("US-10")).toEqual({ block: false });
  });

  it("UT-21 schaltet erst nach fünf Erfolgen frei, isoliert Storys und setzt alles zurück", () => {
    const gate = new ReviewGate();
    gate.finish("US-10");
    for (const reviewer of REVIEWERS.slice(0, -1)) gate.recordSuccess("US-10", reviewer);
    expect(gate.finish("US-10")).toMatchObject({ block: true });
    gate.recordSuccess("US-10", REVIEWERS.at(-1)!);
    expect(gate.finish("US-10")).toEqual({ block: false });
    expect(gate.finish("US-11")).toMatchObject({ block: true });
    gate.reset();
    expect(gate.finish("US-10")).toMatchObject({ block: true });
  });
});

describe("UT-22 IT-10 Agent-Erkennung, Ergebniszuordnung und Reset", () => {
  it("UT-22 IT-10 erzwingt Foreground, korreliert Siblings und zählt nur erfolgreiche Ergebnisse", async () => {
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
    })(harness.api);
    const context = harness.context("/repo");
    const finish = (id: string) => ({
      toolCallId: id,
      toolName: "trellis_transition",
      input: { story_id: "US-10", action: "finish" },
    });

    await expect(harness.toolCall()(finish("finish-1"), context)).resolves.toMatchObject({ block: true });
    const calls = REVIEWERS.map((reviewer, index) => ({
      toolCallId: `review-${index}`,
      toolName: "Agent",
      input: { subagent_type: reviewer, run_in_background: true },
    }));
    await Promise.all(calls.map((call) => harness.toolCall()(call, context)));
    expect(calls.every((call) => call.input.run_in_background === false)).toBe(true);

    await harness.toolResult()({ ...calls[0], isError: undefined as unknown as boolean }, context);
    for (const call of calls.slice(1)) await harness.toolResult()({ ...call, isError: false }, context);
    const stillBlocked = await harness.toolCall()(finish("finish-2"), context) as { reason: string };
    expect(stillBlocked.reason).toContain(REVIEWERS[0]);

    const retry = {
      toolCallId: "review-retry",
      toolName: "Agent",
      input: { subagent_type: REVIEWERS[0], run_in_background: true },
    };
    await harness.toolCall()(retry, context);
    expect(retry.input.run_in_background).toBe(false);
    await harness.toolResult()({ ...retry, isError: false }, context);
    await expect(harness.toolCall()(finish("finish-3"), context)).resolves.toBeUndefined();
    await harness.toolResult()({ ...finish("finish-3"), isError: true }, context);
    await expect(harness.toolCall()(finish("finish-after-downstream-error"), context))
      .resolves.toBeUndefined();

    const otherFinish = (id: string) => ({
      toolCallId: id,
      toolName: "trellis_transition",
      input: { story_id: "US-11", action: "finish" },
    });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await expect(harness.toolCall()(otherFinish(`other-${attempt}`), context))
        .resolves.toMatchObject({ block: true });
    }
    await expect(harness.toolCall()(otherFinish("other-4"), context)).resolves.toBeUndefined();
    expect(harness.notifications.at(-1)).toMatchObject({ level: "warning" });
  });

  it("UT-22 ignoriert fremde Agenten und unbekannte Ergebnisse und resettiert bei session_start", async () => {
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
    })(harness.api);
    const context = harness.context("/repo");
    const finish = {
      toolCallId: "finish",
      toolName: "trellis_transition",
      input: { story_id: "US-10", action: "finish" },
    };
    await harness.toolCall()(finish, context);
    const foreign = {
      toolCallId: "foreign",
      toolName: "Agent",
      input: { subagent_type: "other-agent", run_in_background: true },
    };
    await harness.toolCall()(foreign, context);
    expect(foreign.input.run_in_background).toBe(true);
    await harness.toolResult()({ ...foreign, isError: false }, context);
    await harness.toolResult()({
      toolCallId: "unknown",
      toolName: "Agent",
      input: { subagent_type: REVIEWERS[0] },
      isError: false,
    }, context);
    const pendingBeforeReset = {
      toolCallId: "pending-before-reset",
      toolName: "Agent",
      input: { subagent_type: REVIEWERS[0], run_in_background: true },
    };
    await harness.toolCall()(pendingBeforeReset, context);
    await harness.sessionStart()({ reason: "new" }, context);
    await harness.toolResult()({ ...pendingBeforeReset, isError: false }, context);
    const afterReset = await harness.toolCall()({ ...finish, toolCallId: "finish-new" }, context) as {
      block: boolean;
      reason: string;
    };
    expect(afterReset.block).toBe(true);
    expect(afterReset.reason).toContain(REVIEWERS[0]);
  });
});
