import { describe, expect, it, vi } from "vitest";
import type { TrellisOverview } from "../src/context.js";
import {
  assistantTotalTokens,
  StoryUsageTracker,
  UsageDeltaReporter,
  type UsageCommandResult,
} from "../src/token-usage.js";

const assistant = (totalTokens: number) => ({
  role: "assistant",
  usage: { totalTokens },
});

const overview = (...stories: Array<{ id: string; status: string; worktree_path?: string }>): TrellisOverview => ({
  stories,
});

const empty = overview();
const active = (id = "US-14", path = "/repo") => overview({ id, status: "in_progress", worktree_path: path });
const done = (id = "US-14") => overview({ id, status: "done" });

describe("UT-31 UT-34 Trellis-Overview-basierte Token-Usage-Attribution und Story-Statuswechsel", () => {
  it("UT-31 UT-34 attribuiert Start-, Lauf- und Finish-Turn nur aus Overviews", () => {
    const tracker = new StoryUsageTracker();

    tracker.beginTurn(empty, "/repo");
    expect(tracker.endTurn(assistant(3), empty, "/repo")).toBeUndefined();

    tracker.beginTurn(empty, "/repo");
    tracker.recordSubagent({ id: "start-agent", usage: { totalTokens: 5 } });
    expect(tracker.endTurn(assistant(7), active(), "/repo")).toEqual({
      storyId: "US-14", main: 7, subagents: 5,
    });

    tracker.beginTurn(active(), "/repo");
    expect(tracker.endTurn(assistant(11), active(), "/repo")).toEqual({
      storyId: "US-14", main: 11, subagents: 0,
    });

    tracker.beginTurn(active(), "/repo");
    expect(tracker.endTurn(assistant(17), done(), "/repo")).toEqual({
      storyId: "US-14", main: 17, subagents: 0,
    });

    tracker.beginTurn(done(), "/repo");
    expect(tracker.endTurn(assistant(19), done(), "/repo")).toBeUndefined();
  });

  it("UT-31 UT-34 verwendet aktualisiertes Start-Trellis-Overview statt Tool-Aufrufformen", () => {
    const tracker = new StoryUsageTracker();
    tracker.beginTurn(empty, "/repo");
    tracker.updateTurnStartOverview(active("US-14", "/repo"), "/repo");

    const message = {
      ...assistant(23),
      content: [{
        type: "text",
        text: "await tools.trellis_transition({story_id: 'US-999', action: 'finish'})",
      }],
    };
    expect(tracker.endTurn(message, done("US-14"), "/repo")).toEqual({
      storyId: "US-14", main: 23, subagents: 0,
    });
  });
});

describe("UT-35 Eindeutige Worktree-Pfad-Entsprechung", () => {
  const multiple = overview(
    { id: "US-14", status: "in_progress", worktree_path: "/work/US-14" },
    { id: "US-15", status: "in_progress", worktree_path: "/work/US-15" },
  );

  it("UT-35 attribuiert bei genau einer ctx.cwd-Entsprechung", () => {
    const tracker = new StoryUsageTracker();
    tracker.beginTurn(empty, "/work/US-15");
    expect(tracker.endTurn(assistant(29), multiple, "/work/US-15")).toEqual({
      storyId: "US-15", main: 29, subagents: 0,
    });
  });

  it("UT-35 verwirft und warnt bei keiner oder mehrfacher Entsprechung", () => {
    const warn = vi.fn();
    const tracker = new StoryUsageTracker(warn);

    tracker.beginTurn(empty, "/work/other");
    expect(tracker.endTurn(assistant(31), multiple, "/work/other")).toBeUndefined();

    const duplicatePaths = overview(
      { id: "US-14", status: "in_progress", worktree_path: "/work/shared" },
      { id: "US-15", status: "in_progress", worktree_path: "/work/shared" },
    );
    tracker.beginTurn(empty, "/work/shared");
    expect(tracker.endTurn(assistant(37), duplicatePaths, "/work/shared")).toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      "Token-Usage nicht attribuiert: mehrere in_progress-Storys ohne eindeutigen Worktree-Pfad für ctx.cwd",
    );
  });

  it("UT-35 verwirft Turn nach mehrdeutigem Start-Trellis-Overview trotz eindeutigem End-Trellis-Overview", () => {
    const warn = vi.fn();
    const tracker = new StoryUsageTracker(warn);
    tracker.beginTurn(multiple, "/work/other");

    expect(tracker.endTurn(
      assistant(41),
      overview(
        { id: "US-14", status: "done", worktree_path: "/work/US-14" },
        { id: "US-15", status: "in_progress", worktree_path: "/work/US-15" },
      ),
      "/work/US-15",
    )).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("UT-32 Haupt-Agent-Token-Usage und Subagent-Token-Usage aus pi-subagents-Records", () => {
  it("UT-32 liest ausschließlich gültige totalTokens und dedupliziert pi-subagents-Records", () => {
    const tracker = new StoryUsageTracker();
    tracker.beginTurn(empty, "/repo");

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
    }, active(), "/repo")).toEqual({ storyId: "US-14", main: 31, subagents: 52 });

    tracker.recordSubagent({ id: "between-turns", usage: { totalTokens: 37 } });
    tracker.beginTurn(active(), "/repo");
    expect(tracker.endTurn(assistant(0), active(), "/repo")).toEqual({
      storyId: "US-14", main: 0, subagents: 37,
    });
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

describe("UT-33 UT-35 CLI-Argumente, Serialisierung und Retry", () => {
  it("UT-33 UT-35 sendet exakte Usage-Deltas einmal, serialisiert neue Token-Usage und kehrt ohne Await zurück", async () => {
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
  });

  it("UT-33 UT-35 behält fehlgeschlagene Usage-Deltas, warnt und versucht sie später erneut", async () => {
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
