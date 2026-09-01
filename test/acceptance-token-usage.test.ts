import { describe, expect, it, vi } from "vitest";
import { createTrellisExtension } from "../src/index.js";
import { REVIEWERS } from "../src/review-gate.js";
import type { TrellisOverview } from "../src/context.js";
import { createPiHarness } from "./harness.js";

const overview: TrellisOverview = {
  description: "test",
  glossary: [],
  stories: [],
  stale_nodes: [],
};

const assistant = (totalTokens: number) => ({
  role: "assistant",
  usage: { totalTokens },
  content: [],
});

async function setup() {
  const harness = createPiHarness();
  createTrellisExtension({
    readTextFile: async () => "trellis-project: project-c325\n",
    getOverview: async () => overview,
    ensureAgentRecipes: async () => {},
  })(harness.api);
  const context = harness.context("/repo");
  await harness.sessionStart()({ reason: "startup" }, context);
  return { harness, context };
}

async function beginTurn(
  harness: ReturnType<typeof createPiHarness>,
  context: ReturnType<ReturnType<typeof createPiHarness>["context"]>,
  turnIndex: number,
) {
  await harness.turnStart()({ turnIndex, timestamp: turnIndex }, context);
}

async function startStory(
  harness: ReturnType<typeof createPiHarness>,
  context: ReturnType<ReturnType<typeof createPiHarness>["context"]>,
  id = "start",
) {
  const call = {
    toolCallId: id,
    toolName: "trellis_transition",
    input: { story_id: "US-14", action: "start" },
  };
  await harness.toolCall()(call, context);
  await harness.toolResult()({ ...call, isError: false }, context);
}

async function finishStory(
  harness: ReturnType<typeof createPiHarness>,
  context: ReturnType<ReturnType<typeof createPiHarness>["context"]>,
) {
  const blocked = {
    toolCallId: "finish-blocked",
    toolName: "trellis_transition",
    input: { story_id: "US-14", action: "finish" },
  };
  await expect(harness.toolCall()(blocked, context)).resolves.toMatchObject({ block: true });
  for (const [index, reviewer] of REVIEWERS.entries()) {
    const call = {
      toolCallId: `review-${index}`,
      toolName: "Agent",
      input: { subagent_type: reviewer, run_in_background: true },
    };
    await harness.toolCall()(call, context);
    await harness.toolResult()({ ...call, isError: false }, context);
  }
  const finish = {
    toolCallId: "finish-success",
    toolName: "trellis_transition",
    input: { story_id: "US-14", action: "finish" },
  };
  await harness.toolCall()(finish, context);
  await harness.toolResult()({ ...finish, isError: false }, context);
}

describe("US-14 Token-Usage pro Story", () => {
  it("AT-19 IT-14 trennt Haupt-Agent-Token-Usage und Subagent-Token-Usage aus pi-subagents-Records", async () => {
    const { harness, context } = await setup();
    await beginTurn(harness, context, 0);
    harness.emitEvent("subagents:completed", {
      id: "agent-ok",
      usage: { totalTokens: 13 },
      result: "LLM behauptet 13000 Tokens",
    });
    harness.emitEvent("subagents:failed", {
      id: "agent-failed",
      usage: { totalTokens: 17 },
      error: "LLM behauptet 17000 Tokens",
    });
    await startStory(harness, context);
    await harness.turnEnd()({
      turnIndex: 0,
      message: {
        ...assistant(11),
        content: [{ type: "text", text: "LLM behauptet 11000 Tokens" }],
      },
      toolResults: [],
    }, context);

    expect(harness.execCalls).toHaveLength(1);
    expect(harness.execCalls[0]).toMatchObject({
      command: "trellis",
      args: ["usage", "add", "project-c325", "US-14", "--main", "11", "--subagents", "30"],
    });
  });

  it("AT-20 IT-14 ordnet Start- bis Finish-Turn zu und verwirft Außen-Turns", async () => {
    const { harness, context } = await setup();

    await beginTurn(harness, context, 0);
    await harness.turnEnd()({ turnIndex: 0, message: assistant(2) }, context);
    expect(harness.execCalls).toHaveLength(0);

    await beginTurn(harness, context, 1);
    await startStory(harness, context);
    await harness.turnEnd()({ turnIndex: 1, message: assistant(3) }, context);

    await beginTurn(harness, context, 2);
    await harness.turnEnd()({ turnIndex: 2, message: assistant(5) }, context);

    await beginTurn(harness, context, 3);
    await finishStory(harness, context);
    await harness.turnEnd()({ turnIndex: 3, message: assistant(7) }, context);

    await beginTurn(harness, context, 4);
    await harness.turnEnd()({ turnIndex: 4, message: assistant(11) }, context);

    await vi.waitFor(() => expect(harness.execCalls).toHaveLength(3));
    expect(harness.execCalls.map((call) => call.args[5])).toEqual(["3", "5", "7"]);
  });

  it("AT-21 IT-14 meldet laufende genaue Usage-Deltas einschließlich Finish-Turn ohne erneute Sendung", async () => {
    const { harness, context } = await setup();
    await beginTurn(harness, context, 0);
    await startStory(harness, context);
    await harness.turnEnd()({ turnIndex: 0, message: assistant(19) }, context);
    await vi.waitFor(() => expect(harness.execCalls).toHaveLength(1));

    await beginTurn(harness, context, 1);
    harness.emitEvent("subagents:completed", { id: "agent", usage: { totalTokens: 23 } });
    await harness.turnEnd()({ turnIndex: 1, message: assistant(29) }, context);
    await vi.waitFor(() => expect(harness.execCalls).toHaveLength(2));

    await beginTurn(harness, context, 2);
    await finishStory(harness, context);
    await harness.turnEnd()({ turnIndex: 2, message: assistant(31) }, context);
    await vi.waitFor(() => expect(harness.execCalls).toHaveLength(3));

    await beginTurn(harness, context, 3);
    await harness.turnEnd()({ turnIndex: 3, message: assistant(37) }, context);

    expect(harness.execCalls.map((call) => call.args)).toEqual([
      ["usage", "add", "project-c325", "US-14", "--main", "19", "--subagents", "0"],
      ["usage", "add", "project-c325", "US-14", "--main", "29", "--subagents", "23"],
      ["usage", "add", "project-c325", "US-14", "--main", "31", "--subagents", "0"],
    ]);
  });

  it("AT-22 IT-14 warnt bei CLI-Fehler, blockiert turn_end nicht und versucht Usage-Delta erneut", async () => {
    const { harness, context } = await setup();
    let resolveCommand: ((result: { stdout: string; stderr: string; code: number; killed: boolean }) => void) | undefined;
    const pending = new Promise<{ stdout: string; stderr: string; code: number; killed: boolean }>((resolve) => {
      resolveCommand = resolve;
    });
    harness.setExecImplementation(() => pending);

    await beginTurn(harness, context, 0);
    await startStory(harness, context);
    await expect(harness.turnEnd()({ turnIndex: 0, message: assistant(31) }, context)).resolves.toBeUndefined();
    expect(harness.execCalls).toHaveLength(1);

    resolveCommand?.({ stdout: "", stderr: "story unknown", code: 1, killed: false });
    await vi.waitFor(() => expect(harness.notifications).toContainEqual({
      message: "Token-Usage für US-14 nicht gemeldet: story unknown",
      level: "warning",
    }));

    harness.setExecImplementation(async () => ({ stdout: "", stderr: "", code: 0, killed: false }));
    await beginTurn(harness, context, 1);
    await harness.turnEnd()({ turnIndex: 1, message: assistant(0) }, context);
    await vi.waitFor(() => expect(harness.execCalls).toHaveLength(2));
    expect(harness.execCalls[1].args).toEqual(
      ["usage", "add", "project-c325", "US-14", "--main", "31", "--subagents", "0"],
    );
    await expect(harness.toolCall()({
      toolCallId: "unrelated",
      toolName: "bash",
      input: { command: "true" },
    }, context)).resolves.toBeUndefined();
  });
});
