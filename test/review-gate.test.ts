import { describe, expect, it } from "vitest";
import { createTrellisExtension } from "../src/index.js";
import {
  finishStoryIdFromToolCall,
  REVIEW_GATE_INSTRUCTION,
  reviewGateReason,
} from "../src/review-gate.js";
import { createPiHarness } from "./harness.js";

describe("UT-20 finish-Erkennung, Blockverbrauch und Review-Anweisung", () => {
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
    expect(finishStoryIdFromToolCall("mcp", {
      server: "trellis",
      tool: "other",
      args: { story_id: "US-9", action: "finish" },
    })).toBeUndefined();
    expect(finishStoryIdFromToolCall("bash", {
      story_id: "US-9",
      action: "finish",
    })).toBeUndefined();
  });

  it("UT-20 weist Agent-Tool, Parallelität, Inline-Fallback, Abwägung und Re-Call an", () => {
    const reason = reviewGateReason("US-9");
    expect(reason).toContain("US-9");
    for (const text of [
      "pre-finish-review",
      "relic-hunter",
      "Agent-Tool",
      "parallel",
      "inline",
      "read-only",
      "Wiege",
      "finish",
      "erneut",
    ]) {
      expect(REVIEW_GATE_INSTRUCTION).toContain(text);
      expect(reason).toContain(text);
    }
  });

  it("UT-20 verbraucht den ersten Block sofort pro Story und setzt ihn bei session_start zurück", async () => {
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
      toolCallId: "one",
      toolName: "trellis_transition",
      input: { story_id: "US-9", action: "finish" },
    };

    await expect(harness.toolCall()(finish, context)).resolves.toMatchObject({ block: true });
    await expect(harness.toolCall()({ ...finish, toolCallId: "two" }, context)).resolves.toBeUndefined();
    await expect(harness.toolCall()({
      ...finish,
      toolCallId: "three",
      input: { story_id: "US-10", action: "finish" },
    }, context)).resolves.toMatchObject({ block: true });
    await expect(harness.toolCall()({
      ...finish,
      toolCallId: "four",
      input: { story_id: "US-9", action: "start" },
    }, context)).resolves.toBeUndefined();

    await harness.sessionStart()({ reason: "new" }, context);
    await expect(harness.toolCall()({ ...finish, toolCallId: "five" }, context))
      .resolves.toMatchObject({ block: true });
  });
});
