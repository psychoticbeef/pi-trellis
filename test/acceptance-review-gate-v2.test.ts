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


describe("AT-26 Proaktive Review-Ergebnisse robust und storybezogen zählen", () => {
  it("AT-26 lässt erstes finish nach fünf proaktiven Trellis-Overview-zugeordneten Erfolgen passieren", async () => {
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-1\n",
      getOverview: async () => ({
        stories: [
          { id: "US-16", status: "in_progress", worktree_path: "/repo/us-16" },
          { id: "US-17", status: "in_progress", worktree_path: "/repo/us-17" },
        ],
      }),
    })(harness.api);
    const context = harness.context("/repo/us-16");
    await harness.commands.get("trellis:on")!("", context);

    const calls = REVIEWERS.map((reviewer, index) => ({
      toolCallId: `at-26-review-${index}`,
      toolName: "Agent",
      input: { subagent_type: reviewer, run_in_background: true },
    }));
    await Promise.all(calls.map((call) => harness.toolCall()(call, context)));
    await Promise.all(calls.map((call) => harness.toolResult()({ ...call, isError: false }, context)));

    expect(calls.every((call) => call.input.run_in_background === false)).toBe(true);
    await expect(harness.toolCall()({
      toolCallId: "at-26-first-finish",
      toolName: "trellis_transition",
      input: { story_id: "US-16", action: "finish" },
    }, context)).resolves.toBeUndefined();
  });
});

describe("AT-27 Trellis-Kontextblock verhindert proaktive Review-Runden", () => {
  it("AT-27 zeigt Hinweis bis zur sitzungsgebundenen Freischaltung", async () => {
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-1\n",
      getOverview: async () => ({
        stories: [{ id: "US-16", status: "in_progress", worktree_path: "/repo/us-16" }],
      }),
    })(harness.api);
    const context = harness.context("/repo/us-16");
    await harness.commands.get("trellis:on")!("", context);

    const before = await harness.beforeAgentStart()({ systemPrompt: "base" }, context);
    expect(before?.systemPrompt).toContain("Reviews nicht proaktiv starten; finish fordert Review-Runde an.");

    const finish = (toolCallId: string) => ({
      toolCallId,
      toolName: "trellis_transition",
      input: { story_id: "US-16", action: "finish" },
    });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await expect(harness.toolCall()(finish(`at-27-block-${attempt}`), context))
        .resolves.toMatchObject({ block: true });
    }
    await expect(harness.toolCall()(finish("at-27-fail-open"), context)).resolves.toBeUndefined();

    const after = await harness.beforeAgentStart()({ systemPrompt: "base" }, context);
    expect(after?.systemPrompt).not.toContain("Reviews nicht proaktiv starten");
  });
});


describe("AT-26 Robustheitsnetz für Teilfortschritt, Fallback und Fail-open", () => {
  it("AT-26 zählt Teilfortschritt nur bei isError=false und nennt beim ersten finish nur fehlende Reviewer", async () => {
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-1\n",
      getOverview: async () => ({ stories: [{ id: "US-16", status: "in_progress" }] }),
    })(harness.api);
    const context = harness.context("/repo/us-16");
    await harness.commands.get("trellis:on")!("", context);

    const success = {
      toolCallId: "at-26-partial-success",
      toolName: "Agent",
      input: { subagent_type: REVIEWERS[0], run_in_background: true },
    };
    const failure = {
      toolCallId: "at-26-partial-failure",
      toolName: "Agent",
      input: { subagent_type: REVIEWERS[1], run_in_background: true },
    };
    await harness.toolCall()(success, context);
    await harness.toolCall()(failure, context);
    await harness.toolResult()({ ...success, isError: false }, context);
    await harness.toolResult()({ ...failure, isError: true }, context);

    const blocked = await harness.toolCall()({
      toolCallId: "at-26-partial-finish",
      toolName: "trellis_transition",
      input: { story_id: "US-16", action: "finish" },
    }, context) as { reason: string };
    const missing = blocked.reason.split("Fehlend:")[1];
    expect(missing).not.toContain(REVIEWERS[0]);
    expect(missing).toContain(REVIEWERS[1]);
  });

  it("AT-26 verwirft mehrdeutige proaktive Zuordnung, nutzt Block-Fallback und behält Fail-open samt Reset", async () => {
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-1\n",
      getOverview: async () => ({
        stories: [
          { id: "US-16", status: "in_progress", worktree_path: "/repo/a" },
          { id: "US-17", status: "in_progress", worktree_path: "/repo/b" },
        ],
      }),
    })(harness.api);
    const context = harness.context("/repo/none");
    await harness.commands.get("trellis:on")!("", context);
    const reviewer = {
      toolCallId: "at-26-ambiguous",
      toolName: "Agent",
      input: { subagent_type: REVIEWERS[0], run_in_background: true },
    };
    await harness.toolCall()(reviewer, context);
    expect(reviewer.input.run_in_background).toBe(true);

    const finish = (id: string) => ({
      toolCallId: id,
      toolName: "trellis_transition",
      input: { story_id: "US-16", action: "finish" },
    });
    await expect(harness.toolCall()(finish("at-26-block-1"), context)).resolves.toMatchObject({ block: true });
    const fallback = { ...reviewer, toolCallId: "at-26-fallback", input: { ...reviewer.input } };
    await harness.toolCall()(fallback, context);
    expect(fallback.input.run_in_background).toBe(false);
    await harness.toolResult()({ ...fallback, isError: false }, context);
    await expect(harness.toolCall()(finish("at-26-block-2"), context)).resolves.toMatchObject({ block: true });
    await expect(harness.toolCall()(finish("at-26-block-3"), context)).resolves.toMatchObject({ block: true });
    await expect(harness.toolCall()(finish("at-26-fail-open"), context)).resolves.toBeUndefined();
    expect(harness.notifications.at(-1)).toMatchObject({ level: "warning" });

    await harness.sessionStart()({ reason: "new" }, context);
    await expect(harness.toolCall()(finish("at-26-after-reset"), context)).resolves.toMatchObject({ block: true });
  });
});
