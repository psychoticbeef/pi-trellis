import { describe, expect, it } from "vitest";
import { createTrellisExtension } from "../src/index.js";
import { REVIEWERS } from "../src/review-gate.js";
import { createPiHarness } from "./harness.js";

describe("AT-13 Verifiziertes Review-Gate v2 Ende-zu-Ende", () => {
  it("AT-13 erfüllt vollständige Instruktion, Verifikation, Story-Isolation, Fail-open und Sitzungsreset", async () => {
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
    })(harness.api);
    const context = harness.context("/repo");
    const finish = (storyId: string, toolCallId: string) => ({
      toolCallId,
      toolName: "trellis_transition",
      input: { story_id: storyId, action: "finish" },
    });

    const first = await harness.toolCall()(finish("US-10", "finish-1"), context) as {
      block: boolean;
      reason: string;
    };
    expect(first.block).toBe(true);
    expect(first.reason).toContain("parallel");
    for (const reviewer of REVIEWERS) expect(first.reason).toContain(reviewer);

    const calls = REVIEWERS.map((reviewer, index) => ({
      toolCallId: `agent-${index}`,
      toolName: "Agent",
      input: { subagent_type: reviewer, run_in_background: true },
    }));
    await Promise.all(calls.map((call) => harness.toolCall()(call, context)));
    expect(calls.every((call) => call.input.run_in_background === false)).toBe(true);
    await Promise.all(calls.map((call) => harness.toolResult()({ ...call, isError: false }, context)));
    const passedFinish = finish("US-10", "finish-2");
    await expect(harness.toolCall()(passedFinish, context)).resolves.toBeUndefined();
    await harness.toolResult()({ ...passedFinish, isError: true }, context);
    await expect(harness.toolCall()(finish("US-10", "finish-3"), context)).resolves.toBeUndefined();

    await expect(harness.toolCall()(finish("US-11", "other-1"), context)).resolves.toMatchObject({ block: true });
    await expect(harness.toolCall()(finish("US-11", "other-2"), context)).resolves.toMatchObject({ block: true });
    const third = await harness.toolCall()(finish("US-11", "other-3"), context) as { reason: string };
    expect(third.reason).toContain("nächste finish-Aufruf");
    await expect(harness.toolCall()(finish("US-11", "other-4"), context)).resolves.toBeUndefined();
    expect(harness.notifications.at(-1)).toMatchObject({ level: "warning" });

    await harness.sessionStart()({ reason: "new" }, context);
    await expect(harness.toolCall()(finish("US-10", "finish-new-session"), context))
      .resolves.toMatchObject({ block: true });
  });
});
