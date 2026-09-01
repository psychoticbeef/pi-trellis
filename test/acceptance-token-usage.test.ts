import { describe, expect, it, vi } from "vitest";
import { createTrellisExtension } from "../src/index.js";
import type { TrellisOverview } from "../src/context.js";
import { createPiHarness } from "./harness.js";

const overview = (...stories: Array<{ id: string; status: string; worktree_path?: string }>): TrellisOverview => ({
  description: "test",
  glossary: [],
  stories,
  stale_nodes: [],
});

const empty = overview();
const active = (id = "US-14", path = "/repo") => overview({ id, status: "in_progress", worktree_path: path });
const done = (id = "US-14") => overview({ id, status: "done" });

const assistant = (totalTokens: number) => ({
  role: "assistant",
  usage: { totalTokens },
  content: [],
});

async function setup(cwd = "/repo") {
  let currentOverview = empty;
  const harness = createPiHarness();
  createTrellisExtension({
    readTextFile: async () => "trellis-project: project-c325\n",
    getOverview: async () => currentOverview,
    ensureAgentRecipes: async () => {},
  })(harness.api);
  const context = harness.context(cwd);
  await harness.sessionStart()({ reason: "startup" }, context);
  return {
    harness,
    context,
    setOverview: (value: TrellisOverview) => {
      currentOverview = value;
    },
  };
}

async function beginTurn(
  harness: ReturnType<typeof createPiHarness>,
  context: ReturnType<ReturnType<typeof createPiHarness>["context"]>,
  turnIndex: number,
) {
  await harness.turnStart()({ turnIndex, timestamp: turnIndex }, context);
}

describe("US-14 US-15 Token-Usage pro Story", () => {
  it("AT-19 AT-23 IT-14 IT-15 trennt Usage-Quellen und attribuiert Start-Turn per Overview", async () => {
    const { harness, context, setOverview } = await setup();
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
    await harness.toolCall()({
      toolCallId: "direct-start",
      toolName: "trellis_transition",
      input: { story_id: "US-999", action: "start" },
    }, context);
    await harness.toolCall()({
      toolCallId: "gateway-start",
      toolName: "mcp",
      input: {
        server: "trellis",
        tool: "transition",
        args: { story_id: "US-998", action: "start" },
      },
    }, context);
    await harness.toolCall()({
      toolCallId: "scripted-start",
      toolName: "mcpScript",
      input: {
        code: "await tools.trellis_transition({story_id: 'US-997', action: 'start'})",
      },
    }, context);
    setOverview(active());
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

  it("AT-20 AT-23 IT-14 IT-15 ordnet Start- bis Finish-Turn per Statuswechsel zu", async () => {
    const { harness, context, setOverview } = await setup();

    await beginTurn(harness, context, 0);
    await harness.turnEnd()({ turnIndex: 0, message: assistant(2) }, context);
    expect(harness.execCalls).toHaveLength(0);

    await beginTurn(harness, context, 1);
    setOverview(active());
    await harness.turnEnd()({ turnIndex: 1, message: assistant(3) }, context);

    await beginTurn(harness, context, 2);
    await harness.turnEnd()({ turnIndex: 2, message: assistant(5) }, context);

    await beginTurn(harness, context, 3);
    await harness.toolCall()({
      toolCallId: "scripted-finish",
      toolName: "mcpScript",
      input: {
        code: "await tools.trellis_transition({story_id: 'US-14', action: 'finish'})",
      },
    }, context);
    setOverview(done());
    await harness.turnEnd()({ turnIndex: 3, message: assistant(7) }, context);

    await beginTurn(harness, context, 4);
    await harness.turnEnd()({ turnIndex: 4, message: assistant(11) }, context);

    await vi.waitFor(() => expect(harness.execCalls).toHaveLength(3));
    expect(harness.execCalls.map((call) => call.args[5])).toEqual(["3", "5", "7"]);
  });

  it("AT-24 IT-15 wählt mehrere in_progress-Storys nur per eindeutigem ctx.cwd", async () => {
    const { harness, context, setOverview } = await setup("/work/US-15");
    const matching = overview(
      { id: "US-14", status: "in_progress", worktree_path: "/work/US-14" },
      { id: "US-15", status: "in_progress", worktree_path: "/work/US-15" },
    );

    await beginTurn(harness, context, 0);
    setOverview(matching);
    await harness.turnEnd()({ turnIndex: 0, message: assistant(13) }, context);
    await vi.waitFor(() => expect(harness.execCalls).toHaveLength(1));
    expect(harness.execCalls[0].args[3]).toBe("US-15");

    const ambiguous = overview(
      { id: "US-14", status: "in_progress", worktree_path: "/work/shared" },
      { id: "US-15", status: "in_progress", worktree_path: "/work/other" },
    );
    await beginTurn(harness, context, 1);
    setOverview(ambiguous);
    await harness.turnEnd()({ turnIndex: 1, message: assistant(17) }, context);

    await beginTurn(harness, context, 2);
    setOverview(empty);
    await harness.turnEnd()({ turnIndex: 2, message: assistant(19) }, context);

    const duplicate = overview(
      { id: "US-14", status: "in_progress", worktree_path: "/work/US-15" },
      { id: "US-15", status: "in_progress", worktree_path: "/work/US-15" },
    );
    await beginTurn(harness, context, 3);
    setOverview(duplicate);
    await harness.turnEnd()({ turnIndex: 3, message: assistant(23) }, context);

    expect(harness.execCalls).toHaveLength(1);
    expect(harness.notifications).toContainEqual({
      message: "Token-Usage nicht attribuiert: mehrere in_progress-Storys ohne eindeutigen Worktree-Pfad für ctx.cwd",
      level: "warning",
    });
  });

  it("AT-21 AT-25 IT-14 IT-15 meldet laufende genaue Usage-Deltas genau einmal", async () => {
    const { harness, context, setOverview } = await setup();
    await beginTurn(harness, context, 0);
    setOverview(active());
    await harness.turnEnd()({ turnIndex: 0, message: assistant(19) }, context);
    await vi.waitFor(() => expect(harness.execCalls).toHaveLength(1));

    await beginTurn(harness, context, 1);
    harness.emitEvent("subagents:completed", { id: "agent", usage: { totalTokens: 23 } });
    await harness.turnEnd()({ turnIndex: 1, message: assistant(29) }, context);
    await vi.waitFor(() => expect(harness.execCalls).toHaveLength(2));

    await beginTurn(harness, context, 2);
    setOverview(done());
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

  it("AT-22 AT-25 IT-14 IT-15 warnt bei CLI-Fehler und versucht Usage-Delta erneut", async () => {
    const { harness, context, setOverview } = await setup();
    let resolveCommand: ((result: { stdout: string; stderr: string; code: number; killed: boolean }) => void) | undefined;
    const pending = new Promise<{ stdout: string; stderr: string; code: number; killed: boolean }>((resolve) => {
      resolveCommand = resolve;
    });
    harness.setExecImplementation(() => pending);

    await beginTurn(harness, context, 0);
    setOverview(active());
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
  });
});
