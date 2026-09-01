import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  AutoMode,
  buildAutoModePrompt,
  parseAutoModeAction,
  selectFirstNextStory,
  shouldCompactContext,
} from "../src/auto-mode.js";
import type { TrellisOverview } from "../src/context.js";
import { createTrellisExtension } from "../src/index.js";
import { TrellisMcpClient, type NextStoryResult, type SpawnTrellis } from "../src/mcp-client.js";
import { createPiHarness } from "./harness.js";

const overview: TrellisOverview = {
  description: "Auto-Modus",
  stories: [],
};

const candidate = (id: string, title = `Feature ${id}`) => ({ id, title });

function fakeMcpSpawn(result: unknown): SpawnTrellis {
  return () => spawn(process.execPath, ["-e", String.raw`
const readline = require('node:readline');
const result = ${JSON.stringify(result)};
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{protocolVersion:'2025-03-26',capabilities:{},serverInfo:{name:'fake',version:'1'}}})+'\n');
  }
  if (request.method === 'tools/call') {
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
  }
});
`], { stdio: "pipe" });
}

function setup(nextResults: Array<NextStoryResult | Error>) {
  const harness = createPiHarness();
  let nextCall = 0;
  createTrellisExtension({
    readTextFile: async () => "trellis-project: auto-project\n",
    getOverview: async () => overview,
    nextStory: async () => {
      const result = nextResults[nextCall++] ?? { candidates: [] };
      if (result instanceof Error) throw result;
      return result;
    },
    ensureAgentRecipes: async () => undefined,
  })(harness.api);
  return { harness, context: harness.context("/repo"), nextCalls: () => nextCall };
}

async function activateAuto(
  nextResults: Array<NextStoryResult | Error>,
) {
  const state = setup(nextResults);
  await state.harness.commands.get("trellis:on")!("", state.context);
  await state.harness.commands.get("trellis:auto")!("on", state.context);
  return state;
}

const finishResult = (storyId: string, isError = false) => ({
  toolCallId: `finish-${storyId}`,
  toolName: "trellis_transition",
  input: { story_id: storyId, action: "finish" },
  isError,
});

async function flushCallbacks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("UT-29 Auto-Modus-Zustand, Auswahl, Prompt und Schwelle", () => {
  it("UT-29 validiert Argumente, wählt ersten Kandidaten und baut stabilen Auftrag", () => {
    expect(parseAutoModeAction(" on ")).toBe("on");
    expect(parseAutoModeAction("off")).toBe("off");
    expect(parseAutoModeAction("ON")).toBeUndefined();
    expect(parseAutoModeAction("")).toBeUndefined();

    const story = candidate("US-14", "Nächstes Feature");
    expect(selectFirstNextStory({ candidates: [story, candidate("US-15")] })).toEqual(story);
    expect(selectFirstNextStory({ candidates: [] })).toBeUndefined();
    expect(buildAutoModePrompt(story)).toBe(
      "Auto-Modus: Bearbeite jetzt US-14 „Nächstes Feature“. " +
      "Lies vollständigen Trellis-Spec-Baum und relevante Done-Specs. " +
      "Rufe für US-14 trellis_transition mit action=start auf, implementiere alle Acceptance Criteria, " +
      "führe Tests und Reviews aus und rufe danach finish für US-14 auf. " +
      "Arbeite ausschließlich in von Trellis bereitgestelltem Story-Worktree.",
    );
  });

  it("UT-29 berechnet Grenze strikt oberhalb 75 Prozent und behandelt ungültige Werte sicher", () => {
    expect(shouldCompactContext({ tokens: 750 }, 1_000)).toBe(false);
    expect(shouldCompactContext({ tokens: 751 }, 1_000)).toBe(true);
    expect(shouldCompactContext({ tokens: null }, 1_000)).toBe(false);
    expect(shouldCompactContext(undefined, 1_000)).toBe(false);
    expect(shouldCompactContext({ tokens: 900 }, 0)).toBe(false);
    expect(shouldCompactContext({ tokens: Number.NaN }, 1_000)).toBe(false);
  });

  it("UT-29 entwertet alte Generationen und doppelte Fortsetzungen", () => {
    const mode = new AutoMode();
    const first = mode.enable();
    mode.disable();
    expect(mode.acceptStory(first, "US-14")).toBe(false);

    const second = mode.enable();
    expect(mode.acceptStory(second, "US-14")).toBe(true);
    expect(mode.recordSuccessfulFinish("US-15")).toBe(false);
    expect(mode.recordSuccessfulFinish("US-14")).toBe(true);
    expect(mode.consumeSettled()).toBe(second);
    expect(mode.consumeSettled()).toBeUndefined();
  });

  it("UT-29 validiert next_story structuredContent und fehlerhafte Antworten", async () => {
    const valid = new TrellisMcpClient({
      spawnProcess: fakeMcpSpawn({ structuredContent: { candidates: [candidate("US-14")] } }),
      timeoutMs: 1_000,
    });
    await expect(valid.nextStory("p")).resolves.toEqual({ candidates: [candidate("US-14")] });

    const invalid = new TrellisMcpClient({
      spawnProcess: fakeMcpSpawn({ structuredContent: { candidates: [{ id: "US-14" }] } }),
      timeoutMs: 1_000,
    });
    await expect(invalid.nextStory("p")).rejects.toThrow(/id und title/);
  });
});

describe("UT-30 Event-Korrelation und entwertete Fortsetzungen", () => {
  it("UT-30 setzt nur erfolgreich beendete aktive Story nach agent_settled genau einmal fort", async () => {
    const { harness, context, nextCalls } = await activateAuto([
      { candidates: [candidate("US-14")] },
      { candidates: [candidate("US-15")] },
    ]);
    await harness.toolResult()(finishResult("US-other"), context);
    await harness.agentSettled()({}, context);
    expect(nextCalls()).toBe(1);

    await harness.toolResult()(finishResult("US-14", true), context);
    await harness.agentSettled()({}, context);
    expect(nextCalls()).toBe(1);

    await harness.toolResult()(finishResult("US-14"), context);
    expect(nextCalls()).toBe(1);
    await harness.agentSettled()({}, context);
    expect(nextCalls()).toBe(2);
    await harness.agentSettled()({}, context);
    expect(nextCalls()).toBe(2);
    expect(harness.userMessages).toHaveLength(2);
  });

  it("UT-30 korreliert MCP-Gateway-finish und wartet bei hoher Nutzung auf Compaction", async () => {
    const { harness, context, nextCalls } = await activateAuto([
      { candidates: [candidate("US-14")] },
      { candidates: [candidate("US-15")] },
    ]);
    harness.setContextUsage({ tokens: 751, contextWindow: 1_000, percent: 75.1 });
    harness.setModelContextWindow(1_000);
    await harness.toolResult()({
      toolCallId: "gateway-finish",
      toolName: "mcp",
      input: {
        server: "trellis",
        tool: "transition",
        args: JSON.stringify({ story_id: "US-14", action: "finish" }),
      },
      isError: false,
    }, context);
    await harness.agentSettled()({}, context);
    expect(harness.compactCalls).toHaveLength(1);
    expect(nextCalls()).toBe(1);
    harness.compactCalls[0].onComplete?.({});
    await flushCallbacks();
    expect(nextCalls()).toBe(2);
  });

  it("UT-30 entwertet onError-, off- und session_start-Races und lässt Review-Gate unverändert", async () => {
    const failed = await activateAuto([
      { candidates: [candidate("US-14")] },
      { candidates: [candidate("US-15")] },
    ]);
    failed.harness.setContextUsage({ tokens: 900, contextWindow: 1_000, percent: 90 });
    await failed.harness.toolResult()(finishResult("US-14"), failed.context);
    await failed.harness.agentSettled()({}, failed.context);
    failed.harness.compactCalls[0].onError?.(new Error("boom"));
    failed.harness.compactCalls[0].onComplete?.({});
    await flushCallbacks();
    expect(failed.nextCalls()).toBe(1);
    expect(failed.harness.userMessages).toHaveLength(1);

    const stopped = await activateAuto([
      { candidates: [candidate("US-14")] },
      { candidates: [candidate("US-15")] },
    ]);
    stopped.harness.setContextUsage({ tokens: 900, contextWindow: 1_000, percent: 90 });
    await stopped.harness.toolResult()(finishResult("US-14"), stopped.context);
    await stopped.harness.agentSettled()({}, stopped.context);
    await stopped.harness.commands.get("trellis:auto")!("off", stopped.context);
    stopped.harness.compactCalls[0].onComplete?.({});
    await flushCallbacks();
    expect(stopped.nextCalls()).toBe(1);

    const reset = await activateAuto([{ candidates: [candidate("US-14")] }]);
    await reset.harness.toolResult()(finishResult("US-14"), reset.context);
    await reset.harness.sessionStart()({ reason: "new" }, reset.context);
    await reset.harness.agentSettled()({}, reset.context);
    expect(reset.nextCalls()).toBe(1);

    const gated = setup([]);
    const decision = await gated.harness.toolCall()({
      toolCallId: "review-gate-finish",
      toolName: "trellis_transition",
      input: { story_id: "US-14", action: "finish" },
    }, gated.context) as { block: boolean; reason: string };
    expect(decision.block).toBe(true);
    expect(decision.reason).toContain("Review-Runde");
  });
});

describe("AT-16 Auto-Modus startet nächste Story", () => {
  it("AT-16 aktiviert deterministisch erste Story und lehnt Usage sowie inaktiven Trellis-Modus ab", async () => {
    const inactive = setup([{ candidates: [] }]);
    await inactive.harness.commands.get("trellis:auto")!("on", inactive.context);
    expect(inactive.harness.messages.at(-1)?.content).toContain("aktiven Trellis-Modus");
    await inactive.harness.commands.get("trellis:auto")!("invalid", inactive.context);
    expect(inactive.harness.messages.at(-1)?.content).toBe("Usage: /trellis:auto on|off");

    const { harness } = await activateAuto([{ candidates: [
      candidate("US-14", "Erstes Feature"),
      candidate("US-15", "Zweites Feature"),
    ] }]);
    expect(harness.userMessages).toHaveLength(1);
    expect(harness.userMessages[0]).toContain("US-14");
    expect(harness.userMessages[0]).toContain("Erstes Feature");
    expect(harness.userMessages[0]).not.toContain("US-15");
  });
});

describe("AT-17 Fortsetzung nach finish mit bedingter Compaction", () => {
  it("AT-17 setzt bei 75 Prozent direkt und oberhalb erst nach erfolgreicher Compaction fort", async () => {
    const direct = await activateAuto([
      { candidates: [candidate("US-14")] },
      { candidates: [candidate("US-15")] },
    ]);
    direct.harness.setContextUsage({ tokens: 750, contextWindow: 1_000, percent: 75 });
    await direct.harness.toolResult()(finishResult("US-14"), direct.context);
    await direct.harness.agentSettled()({}, direct.context);
    expect(direct.harness.compactCalls).toHaveLength(0);
    expect(direct.harness.userMessages).toHaveLength(2);

    const compacted = await activateAuto([
      { candidates: [candidate("US-14")] },
      { candidates: [candidate("US-15")] },
    ]);
    compacted.harness.setContextUsage({ tokens: 751, contextWindow: 1_000, percent: 75.1 });
    await compacted.harness.toolResult()(finishResult("US-14"), compacted.context);
    await compacted.harness.agentSettled()({}, compacted.context);
    expect(compacted.harness.userMessages).toHaveLength(1);
    compacted.harness.compactCalls[0].onComplete?.({});
    await flushCallbacks();
    expect(compacted.harness.userMessages).toHaveLength(2);
  });

  it("AT-17 erzeugt nach finish- oder Compaction-Fehler keinen automatischen User-Turn", async () => {
    const failedFinish = await activateAuto([{ candidates: [candidate("US-14")] }]);
    await failedFinish.harness.toolResult()(finishResult("US-14", true), failedFinish.context);
    await failedFinish.harness.agentSettled()({}, failedFinish.context);
    expect(failedFinish.harness.userMessages).toHaveLength(1);

    const failedCompaction = await activateAuto([{ candidates: [candidate("US-14")] }]);
    failedCompaction.harness.setContextUsage({ tokens: 900, contextWindow: 1_000, percent: 90 });
    await failedCompaction.harness.toolResult()(finishResult("US-14"), failedCompaction.context);
    await failedCompaction.harness.agentSettled()({}, failedCompaction.context);
    failedCompaction.harness.compactCalls[0].onError?.(new Error("boom"));
    expect(failedCompaction.harness.userMessages).toHaveLength(1);
    expect(failedCompaction.harness.notifications.at(-1)?.message).toContain("Compaction fehlgeschlagen");
  });
});

describe("AT-18 Sicherer Stopp und leere Auswahl", () => {
  it("AT-18 entwertet Query-, finish- und Compaction-Fortsetzungen durch off und session_start", async () => {
    let resolveNext: ((value: NextStoryResult) => void) | undefined;
    const deferred = new Promise<NextStoryResult>((resolve) => { resolveNext = resolve; });
    const raceHarness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: auto-project\n",
      getOverview: async () => overview,
      nextStory: async () => deferred,
      ensureAgentRecipes: async () => undefined,
    })(raceHarness.api);
    const raceContext = raceHarness.context("/repo");
    await raceHarness.commands.get("trellis:on")!("", raceContext);
    const pendingOn = raceHarness.commands.get("trellis:auto")!("on", raceContext);
    await flushCallbacks();
    await raceHarness.commands.get("trellis:auto")!("off", raceContext);
    resolveNext!({ candidates: [candidate("US-14")] });
    await pendingOn;
    expect(raceHarness.userMessages).toEqual([]);

    const finished = await activateAuto([{ candidates: [candidate("US-14")] }]);
    await finished.harness.toolResult()(finishResult("US-14"), finished.context);
    await finished.harness.commands.get("trellis:auto")!("off", finished.context);
    await finished.harness.agentSettled()({}, finished.context);
    expect(finished.harness.userMessages).toHaveLength(1);

    const compacting = await activateAuto([{ candidates: [candidate("US-14")] }]);
    compacting.harness.setContextUsage({ tokens: 900, contextWindow: 1_000, percent: 90 });
    await compacting.harness.toolResult()(finishResult("US-14"), compacting.context);
    await compacting.harness.agentSettled()({}, compacting.context);
    await compacting.harness.commands.get("trellis:auto")!("off", compacting.context);
    compacting.harness.compactCalls[0].onComplete?.({});
    await flushCallbacks();
    expect(compacting.harness.userMessages).toHaveLength(1);

    const resetting = await activateAuto([{ candidates: [candidate("US-14")] }]);
    await resetting.harness.toolResult()(finishResult("US-14"), resetting.context);
    await resetting.harness.sessionStart()({ reason: "new" }, resetting.context);
    await resetting.harness.agentSettled()({}, resetting.context);
    expect(resetting.harness.userMessages).toHaveLength(1);
  });

  it("AT-18 deaktiviert bei leerer Auswahl und meldet Abschluss", async () => {
    const { harness } = await activateAuto([{ candidates: [] }]);
    expect(harness.userMessages).toEqual([]);
    expect(harness.notifications.at(-1)).toEqual({
      message: "Auto-Modus beendet: keine startbaren Stories mehr vorhanden.",
      level: "info",
    });
  });
});

describe("IT-13 Auto-Modus-Schleife mit MCP-stdio", () => {
  it("IT-13 verbindet Aktivierung, next_story, finish, agent_settled, Compaction und leeres Ende", async () => {
    const results = [
      { structuredContent: overview },
      { structuredContent: { candidates: [candidate("US-14", "MCP Feature 1")] } },
      { structuredContent: { candidates: [candidate("US-15", "MCP Feature 2")] } },
      { structuredContent: { candidates: [candidate("US-16", "MCP Feature 3")] } },
      { structuredContent: overview },
      { structuredContent: { candidates: [] } },
    ];
    let spawnIndex = 0;
    const client = new TrellisMcpClient({
      spawnProcess: () => fakeMcpSpawn(results[spawnIndex++] ?? results.at(-1)!) ("", []),
      timeoutMs: 1_000,
    });
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: auto-project\n",
      getOverview: (projectId, signal) => client.getOverview(projectId, signal),
      nextStory: (projectId, signal) => client.nextStory(projectId, signal),
      ensureAgentRecipes: async () => undefined,
    })(harness.api);
    const context = harness.context("/repo");

    await harness.sessionStart()({ reason: "startup" }, context);
    await harness.commands.get("trellis:auto")!("on", context);
    expect(harness.userMessages[0]).toContain("US-14");
    harness.setContextUsage({ tokens: 900, contextWindow: 1_000, percent: 90 });
    await harness.toolResult()(finishResult("US-14"), context);
    await harness.agentSettled()({}, context);
    expect(harness.compactCalls).toHaveLength(1);
    harness.compactCalls[0].onComplete?.({});
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(harness.userMessages).toHaveLength(2);
    expect(harness.userMessages[1]).toContain("US-15");

    harness.setContextUsage({ tokens: 750, contextWindow: 1_000, percent: 75 });
    await harness.toolResult()(finishResult("US-15"), context);
    await harness.agentSettled()({}, context);
    expect(harness.userMessages).toHaveLength(3);
    expect(harness.userMessages[2]).toContain("US-16");
    expect(harness.compactCalls).toHaveLength(1);

    await harness.commands.get("trellis:auto")!("off", context);
    await harness.toolResult()(finishResult("US-16"), context);
    await harness.agentSettled()({}, context);
    expect(harness.userMessages).toHaveLength(3);

    await harness.sessionStart()({ reason: "new" }, context);
    await harness.commands.get("trellis:auto")!("on", context);
    expect(harness.userMessages).toHaveLength(3);
    expect(harness.notifications.at(-1)?.message).toContain("keine startbaren Stories");
    expect(spawnIndex).toBe(6);
  });
});
