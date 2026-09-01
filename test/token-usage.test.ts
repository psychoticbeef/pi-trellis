import { describe, expect, it, vi } from "vitest";
import type { TrellisOverview } from "../src/context.js";
import {
  assistantTotalTokens,
  StoryUsageTracker,
  UsageDeltaReporter,
  type UsageAmount,
  type UsageCommandResult,
  type UsageDelta,
} from "../src/token-usage.js";

const categories = (input: number, output: number, cacheRead: number, cacheWrite: number): UsageAmount => ({
  categories: {
    input: BigInt(input),
    output: BigInt(output),
    cacheRead: BigInt(cacheRead),
    cacheWrite: BigInt(cacheWrite),
  },
  legacy: 0n,
});
const legacy = (tokens: number): UsageAmount => ({
  categories: { input: 0n, output: 0n, cacheRead: 0n, cacheWrite: 0n },
  legacy: BigInt(tokens),
});
const mixed = (
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
  legacyTokens: number,
): UsageAmount => ({
  categories: {
    input: BigInt(input),
    output: BigInt(output),
    cacheRead: BigInt(cacheRead),
    cacheWrite: BigInt(cacheWrite),
  },
  legacy: BigInt(legacyTokens),
});
const delta = (main: UsageAmount, subagents: UsageAmount, storyId = "US-18"): UsageDelta => ({
  storyId,
  main,
  subagents,
});
const assistant = (totalTokens: number) => ({ role: "assistant", usage: { totalTokens } });
const categorizedAssistant = (input: number, output: number, cacheRead: number, cacheWrite: number) => ({
  role: "assistant",
  usage: { input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite },
});
const overview = (...stories: Array<{ id: string; status: string; worktree_path?: string }>): TrellisOverview => ({
  stories,
});
const empty = overview();
const active = (id = "US-18", path = "/repo") => overview({ id, status: "in_progress", worktree_path: path });
const done = (id = "US-18") => overview({ id, status: "done" });

const categorizedArgs = [
  "usage", "add", "project-c325", "US-18",
  "--main-input", "2", "--main-output", "3", "--main-cache-read", "5", "--main-cache-write", "7",
  "--subagents-input", "11", "--subagents-output", "13",
  "--subagents-cache-read", "17", "--subagents-cache-write", "19",
];
const legacyArgs = [
  "usage", "add", "project-c325", "US-18", "--main", "23", "--subagents", "29",
];

describe("UT-32 UT-40 Kategorisierte Quellen, Fallback und Erhaltung", () => {
  it("UT-40 summiert Kategorien und fällt objektweise verlustfrei auf totalTokens zurück", () => {
    const tracker = new StoryUsageTracker();
    tracker.beginTurn(empty, "/repo");
    tracker.recordSubagent({
      id: "categorized",
      usage: { input: 11, output: 13, cacheRead: 17, cacheWrite: 19, totalTokens: 60 },
    });
    tracker.recordSubagent({ id: "missing-field", usage: { input: 1, output: 2, totalTokens: 29 } });
    tracker.recordSubagent({
      id: "mismatch",
      usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 31 },
    });
    tracker.recordSubagent({ id: "categorized", usage: { totalTokens: 999 } });

    expect(tracker.endTurn(categorizedAssistant(2, 3, 5, 7), active(), "/repo")).toEqual(
      delta(categories(2, 3, 5, 7), mixed(11, 13, 17, 19, 60)),
    );
  });

  it("UT-40 akkumuliert sichere Einzelwerte ohne Präzisionsverlust", () => {
    const tracker = new StoryUsageTracker();
    tracker.beginTurn(active(), "/repo");
    tracker.recordSubagent({ id: "max", usage: { totalTokens: Number.MAX_SAFE_INTEGER } });
    tracker.recordSubagent({ id: "one", usage: { totalTokens: 1 } });
    tracker.recordSubagent({ id: "another-one", usage: { totalTokens: 1 } });

    expect(tracker.endTurn(assistant(0), active(), "/repo")).toEqual(delta(legacy(0), {
      categories: { input: 0n, output: 0n, cacheRead: 0n, cacheWrite: 0n },
      legacy: BigInt(Number.MAX_SAFE_INTEGER) + 2n,
    }));
  });

  it("UT-40 ignoriert ungültige Totals und erhält Legacy-Usage zwischen Turns", () => {
    const tracker = new StoryUsageTracker();
    tracker.recordSubagent({ id: "between", usage: { totalTokens: 37 } });
    tracker.recordSubagent({ id: "negative", usage: { totalTokens: -1 } });
    tracker.recordSubagent({ id: "fraction", usage: { totalTokens: 1.5 } });
    tracker.beginTurn(active(), "/repo");

    expect(tracker.endTurn(assistant(0), active(), "/repo")).toEqual(delta(legacy(0), legacy(37)));
    expect(assistantTotalTokens({ role: "user", usage: { totalTokens: 100 } })).toBe(0);
    expect(assistantTotalTokens({ role: "assistant", usage: { totalTokens: -1 } })).toBe(0);
  });
});

describe("UT-33 UT-41 CLI-Flags, getrennte Bestätigung und Retry", () => {
  it("UT-41 sendet Kategorien und Legacy in getrennten Aufrufen", async () => {
    const run = vi.fn().mockResolvedValue({ code: 0 });
    const reporter = new UsageDeltaReporter(run, vi.fn());
    reporter.add("project-c325", delta(mixed(2, 3, 5, 7, 23), mixed(11, 13, 17, 19, 29)));
    reporter.flush();

    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run).toHaveBeenNthCalledWith(1, "trellis", categorizedArgs);
    expect(run).toHaveBeenNthCalledWith(2, "trellis", legacyArgs);
    expect(categorizedArgs).not.toContain("--main");
    expect(legacyArgs).not.toContain("--main-input");
  });

  it("UT-41 bestätigt Teilerfolg und versucht nur fehlgeschlagene Meldespur erneut", async () => {
    const warn = vi.fn();
    const run = vi.fn()
      .mockResolvedValueOnce({ code: 0 })
      .mockResolvedValueOnce({ code: 1, stderr: "legacy failed" })
      .mockResolvedValueOnce({ code: 0 });
    const reporter = new UsageDeltaReporter(run, warn);
    reporter.add("project-c325", delta(mixed(2, 3, 5, 7, 23), mixed(11, 13, 17, 19, 29)));

    reporter.flush();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(
      "Token-Usage für US-18 nicht gemeldet: legacy failed",
    ));
    reporter.flush();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(3));

    expect(run.mock.calls.map((call) => call[1])).toEqual([categorizedArgs, legacyArgs, legacyArgs]);
    reporter.flush();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("UT-41 serialisiert während laufendem Flush hinzugefügte Kategorien", async () => {
    let resolveFirst: ((result: UsageCommandResult) => void) | undefined;
    const first = new Promise<UsageCommandResult>((resolve) => { resolveFirst = resolve; });
    const run = vi.fn().mockImplementationOnce(() => first).mockResolvedValue({ code: 0 });
    const reporter = new UsageDeltaReporter(run, vi.fn());

    reporter.add("project-c325", delta(categories(2, 3, 5, 7), categories(11, 13, 17, 19)));
    reporter.flush();
    reporter.add("project-c325", delta(categories(1, 1, 1, 1), categories(2, 2, 2, 2)));
    reporter.flush();
    expect(run).toHaveBeenCalledTimes(1);
    resolveFirst?.({ code: 0 });

    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run.mock.calls[1][1]).toEqual([
      "usage", "add", "project-c325", "US-18",
      "--main-input", "1", "--main-output", "1", "--main-cache-read", "1", "--main-cache-write", "1",
      "--subagents-input", "2", "--subagents-output", "2",
      "--subagents-cache-read", "2", "--subagents-cache-write", "2",
    ]);
  });
});

describe("UT-31 UT-34 UT-35 UT-42 Token-Usage-Attribution über Trellis-Overview und Deduplizierung", () => {
  it("UT-42 attribuiert Start-, Lauf- und Finish-Turn, aber keinen Außen-Turn", () => {
    const tracker = new StoryUsageTracker();
    tracker.beginTurn(empty, "/repo");
    expect(tracker.endTurn(assistant(2), empty, "/repo")).toBeUndefined();

    tracker.beginTurn(empty, "/repo");
    expect(tracker.endTurn(assistant(3), active(), "/repo")).toEqual(delta(legacy(3), legacy(0)));
    tracker.beginTurn(active(), "/repo");
    expect(tracker.endTurn(assistant(5), active(), "/repo")).toEqual(delta(legacy(5), legacy(0)));
    tracker.beginTurn(active(), "/repo");
    expect(tracker.endTurn(assistant(7), done(), "/repo")).toEqual(delta(legacy(7), legacy(0)));
    tracker.beginTurn(done(), "/repo");
    expect(tracker.endTurn(assistant(11), done(), "/repo")).toBeUndefined();
  });

  it("UT-42 nutzt eindeutigen Worktree-Pfad und warnt bei Mehrdeutigkeit", () => {
    const warn = vi.fn();
    const tracker = new StoryUsageTracker(warn);
    const multiple = overview(
      { id: "US-17", status: "in_progress", worktree_path: "/work/US-17" },
      { id: "US-18", status: "in_progress", worktree_path: "/work/US-18" },
    );
    tracker.beginTurn(empty, "/work/US-18");
    expect(tracker.endTurn(assistant(13), multiple, "/work/US-18")).toEqual(delta(legacy(13), legacy(0)));

    tracker.beginTurn(multiple, "/work/other");
    expect(tracker.endTurn(assistant(17), multiple, "/work/other")).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("UT-42 dedupliziert kategorisierte pi-subagents-Records und pi-subagents-Records mit Legacy-Usage", () => {
    const tracker = new StoryUsageTracker();
    tracker.beginTurn(active(), "/repo");
    const record = {
      id: "same",
      usage: { input: 2, output: 3, cacheRead: 5, cacheWrite: 7, totalTokens: 17 },
    };
    tracker.recordSubagent(record);
    tracker.recordSubagent(record);
    tracker.recordSubagent({ id: "legacy", usage: { totalTokens: 19 } });

    expect(tracker.endTurn(assistant(0), active(), "/repo")).toEqual(
      delta(legacy(0), mixed(2, 3, 5, 7, 19)),
    );
  });
});
