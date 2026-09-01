import { describe, expect, it, vi } from "vitest";
import {
  assistantTotalTokens,
  StoryUsageTracker,
  transitionFromToolCall,
  UsageDeltaReporter,
  type UsageCommandResult,
} from "../src/token-usage.js";

const assistant = (totalTokens: number) => ({
  role: "assistant",
  usage: { totalTokens },
});

const transition = (toolCallId: string, storyId: string, action: "start" | "finish") => ({
  toolCallId,
  toolName: "trellis_transition",
  input: { story_id: storyId, action },
});

describe("UT-31 Transition-Erkennung und Story-Fenster", () => {
  it("UT-31 erkennt direkte und MCP-transition-Aufrufe strikt", () => {
    expect(transitionFromToolCall("trellis_transition", {
      story_id: "US-14",
      action: "start",
    })).toEqual({ storyId: "US-14", action: "start" });
    expect(transitionFromToolCall("mcp__trellis__transition", {
      story_id: "US-14",
      action: "finish",
    })).toEqual({ storyId: "US-14", action: "finish" });
    expect(transitionFromToolCall("mcp", {
      server: "trellis",
      tool: "transition",
      args: JSON.stringify({ story_id: "US-14", action: "start" }),
    })).toEqual({ storyId: "US-14", action: "start" });
    expect(transitionFromToolCall("mcp", {
      server: "other",
      tool: "transition",
      args: { story_id: "US-14", action: "start" },
    })).toBeUndefined();
    expect(transitionFromToolCall("trellis_transition", {
      story_id: "US-14",
      action: "refine",
    })).toBeUndefined();
  });

  it("UT-31 rechnet gesamten Start- und Finish-Turn und verwirft Außen-Turns", () => {
    const tracker = new StoryUsageTracker();

    tracker.beginTurn();
    expect(tracker.endTurn(assistant(3))).toBeUndefined();

    tracker.beginTurn();
    tracker.recordSubagent({ id: "start-agent", usage: { totalTokens: 5 } });
    const start = transition("start", "US-14", "start");
    tracker.recordTransitionCall(start.toolCallId, start.toolName, start.input);
    tracker.recordTransitionResult(start.toolCallId, false);
    expect(tracker.endTurn(assistant(7))).toEqual({ storyId: "US-14", main: 7, subagents: 5 });

    tracker.beginTurn();
    expect(tracker.endTurn(assistant(11))).toEqual({ storyId: "US-14", main: 11, subagents: 0 });

    tracker.beginTurn();
    const foreignFinish = transition("foreign-finish", "US-15", "finish");
    tracker.recordTransitionCall(foreignFinish.toolCallId, foreignFinish.toolName, foreignFinish.input);
    tracker.recordTransitionResult(foreignFinish.toolCallId, false);
    expect(tracker.endTurn(assistant(12))).toEqual({ storyId: "US-14", main: 12, subagents: 0 });

    tracker.beginTurn();
    const failedFinish = transition("failed-finish", "US-14", "finish");
    tracker.recordTransitionCall(failedFinish.toolCallId, failedFinish.toolName, failedFinish.input);
    tracker.recordTransitionResult(failedFinish.toolCallId, true);
    expect(tracker.endTurn(assistant(13))).toEqual({ storyId: "US-14", main: 13, subagents: 0 });

    tracker.beginTurn();
    const finish = transition("finish", "US-14", "finish");
    tracker.recordTransitionCall(finish.toolCallId, finish.toolName, finish.input);
    tracker.recordTransitionResult(finish.toolCallId, false);
    expect(tracker.endTurn(assistant(17))).toEqual({ storyId: "US-14", main: 17, subagents: 0 });

    tracker.beginTurn();
    expect(tracker.endTurn(assistant(19))).toBeUndefined();
  });
});

describe("UT-32 Haupt-Agent-Token-Usage und Subagent-Token-Usage aus pi-subagents-Records", () => {
  it("UT-32 liest ausschließlich gültige totalTokens und dedupliziert pi-subagents-Records", () => {
    const tracker = new StoryUsageTracker();
    tracker.beginTurn();
    const start = transition("start", "US-14", "start");
    tracker.recordTransitionCall(start.toolCallId, start.toolName, start.input);
    tracker.recordTransitionResult(start.toolCallId, false);

    tracker.recordSubagent({ id: "completed", usage: { totalTokens: 23 }, result: "LLM says 999" });
    tracker.recordSubagent({ id: "completed", usage: { totalTokens: 23 } });
    tracker.recordSubagent({ id: "failed", usage: { totalTokens: 29 }, status: "failed" });
    tracker.recordSubagent({ id: "missing" });
    tracker.recordSubagent({ id: "negative", usage: { totalTokens: -1 } });
    tracker.recordSubagent({ id: "fraction", usage: { totalTokens: 1.5 } });

    expect(tracker.endTurn({
      role: "assistant",
      usage: { totalTokens: 31 },
      content: [{ type: "text", text: "Tokens: 999999" }],
    })).toEqual({ storyId: "US-14", main: 31, subagents: 52 });

    tracker.recordSubagent({ id: "between-turns", usage: { totalTokens: 37 } });
    tracker.beginTurn();
    expect(tracker.endTurn(assistant(0))).toEqual({ storyId: "US-14", main: 0, subagents: 37 });
    expect(assistantTotalTokens({ role: "user", usage: { totalTokens: 100 } })).toBe(0);
    expect(assistantTotalTokens({ role: "assistant", usage: { totalTokens: -1 } })).toBe(0);
  });

  it("UT-32 sendet erfolgreich bestätigte Token-Usage nicht erneut", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0 });
    const reporter = new UsageDeltaReporter(run, vi.fn());
    reporter.add("project-c325", { storyId: "US-14", main: 7, subagents: 5 });
    reporter.flush();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    reporter.flush();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("UT-33 CLI-Argumente, Serialisierung und Retry", () => {
  it("UT-33 sendet exakte Usage-Deltas einmal, serialisiert neue Token-Usage und kehrt ohne Await zurück", async () => {
    let resolveFirst: ((result: UsageCommandResult) => void) | undefined;
    const first = new Promise<UsageCommandResult>((resolve) => {
      resolveFirst = resolve;
    });
    const run = vi.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue({ code: 0 });
    const reporter = new UsageDeltaReporter(run, vi.fn());

    reporter.add("project-c325", { storyId: "US-14", main: 10, subagents: 4 });
    reporter.flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenNthCalledWith(1, "trellis", [
      "usage", "add", "project-c325", "US-14", "--main", "10", "--subagents", "4",
    ]);

    reporter.add("project-c325", { storyId: "US-14", main: 3, subagents: 2 });
    reporter.flush();
    expect(run).toHaveBeenCalledTimes(1);
    resolveFirst?.({ code: 0 });

    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run).toHaveBeenNthCalledWith(2, "trellis", [
      "usage", "add", "project-c325", "US-14", "--main", "3", "--subagents", "2",
    ]);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  });

  it("UT-33 behält fehlgeschlagene Usage-Deltas, warnt und versucht sie später erneut", async () => {
    const warn = vi.fn();
    const run = vi.fn()
      .mockResolvedValueOnce({ code: 127, stderr: "trellis fehlt" })
      .mockRejectedValueOnce(new Error("spawn failed"))
      .mockResolvedValueOnce({ code: 0 });
    const reporter = new UsageDeltaReporter(run, warn);
    reporter.add("project-c325", { storyId: "US-14", main: 41, subagents: 43 });

    reporter.flush();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(
      "Token-Usage für US-14 nicht gemeldet: trellis fehlt",
    ));
    reporter.flush();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(
      "Token-Usage für US-14 nicht gemeldet: spawn failed",
    ));
    reporter.flush();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(3));

    expect(run.mock.calls.map((call) => call[1])).toEqual(Array(3).fill([
      "usage", "add", "project-c325", "US-14", "--main", "41", "--subagents", "43",
    ]));
    reporter.flush();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(3);
  });
});
