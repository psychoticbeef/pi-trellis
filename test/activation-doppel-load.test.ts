import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProcessGuardedTrellisExtension,
  createTrellisExtension,
  TRELLIS_EXTENSION_OWNER_KEY,
} from "../src/index.js";
import { REVIEWERS } from "../src/review-gate.js";
import { createPiHarness } from "./harness.js";

const registry = globalThis as typeof globalThis & Record<symbol, unknown>;

function resetOwner(): void {
  delete registry[TRELLIS_EXTENSION_OWNER_KEY];
}

function dependencies(label: string, calls: string[]) {
  return {
    readTextFile: async () => "trellis-project: project-c325\n",
    getOverview: async () => {
      calls.push(label);
      return {
        description: label,
        stories: [{ id: "US-17", status: "in_progress", worktree_path: "/repo" }],
      };
    },
    ensureAgentRecipes: async () => {},
  };
}

beforeEach(resetOwner);
afterEach(resetOwner);

describe("UT-38 Registry-Besitz, No-op und Session-Persistenz", () => {
  it("UT-38 registriert zweite Instanz nicht und zeigt Hinweis einmal beim session_start", async () => {
    const calls: string[] = [];
    const harness = createPiHarness();
    const first = createProcessGuardedTrellisExtension(createTrellisExtension(dependencies("project", calls)));
    const second = createProcessGuardedTrellisExtension(createTrellisExtension(dependencies("global", calls)));

    expect(TRELLIS_EXTENSION_OWNER_KEY).toBe(Symbol.for("pi-trellis:extension-owner"));
    first(harness.api);
    const state = registry[TRELLIS_EXTENSION_OWNER_KEY] as {
      owners: Set<{ duplicatePending: boolean }>;
    };
    expect(state.owners.size).toBe(1);
    expect([...state.owners][0].duplicatePending).toBe(false);
    const registrations = {
      commands: [...harness.commandRegistrations],
      hooks: [...harness.hookRegistrations],
      events: [...harness.eventSubscriptions],
    };
    second(harness.api);
    expect(state.owners.size).toBe(1);
    expect([...state.owners][0].duplicatePending).toBe(true);

    expect(harness.commandRegistrations).toEqual(registrations.commands);
    expect(harness.hookRegistrations).toEqual(registrations.hooks);
    expect(harness.eventSubscriptions).toEqual(registrations.events);
    expect(new Set(harness.commandRegistrations).size).toBe(harness.commandRegistrations.length);

    const context = harness.context("/repo");
    await harness.sessionStart()({ reason: "startup" }, context);
    expect(calls).toEqual(["project"]);
    expect(harness.notifications).toContainEqual({
      message: "Doppel-Load erkannt; zweite pi-trellis-Instanz übersprungen.",
      level: "info",
    });
    expect([...state.owners][0].duplicatePending).toBe(false);

    await harness.sessionStart()({ reason: "new" }, context);
    expect(harness.notifications.filter((entry) => entry.level === "info")).toHaveLength(1);
    second(harness.api);
    await harness.sessionStart()({ reason: "new" }, context);
    expect(harness.notifications.filter((entry) => entry.level === "info")).toHaveLength(2);
    expect(calls).toEqual(["project", "project", "project"]);
  });

  it("UT-38 lässt getrennte pi-Runtimes im selben Prozess unabhängig aktivieren", async () => {
    const firstHarness = createPiHarness();
    const secondHarness = createPiHarness();
    const firstCalls: string[] = [];
    const secondCalls: string[] = [];

    createProcessGuardedTrellisExtension(
      createTrellisExtension(dependencies("first-runtime", firstCalls)),
    )(firstHarness.api);
    createProcessGuardedTrellisExtension(
      createTrellisExtension(dependencies("second-runtime", secondCalls)),
    )(secondHarness.api);

    const state = registry[TRELLIS_EXTENSION_OWNER_KEY] as { owners: Set<unknown> };
    expect(state.owners.size).toBe(2);
    expect(firstHarness.commandRegistrations.length).toBeGreaterThan(0);
    expect(secondHarness.commandRegistrations.length).toBeGreaterThan(0);
    await firstHarness.sessionStart()({ reason: "startup" }, firstHarness.context("/repo"));
    await secondHarness.sessionStart()({ reason: "startup" }, secondHarness.context("/repo"));
    expect(firstCalls).toEqual(["first-runtime"]);
    expect(secondCalls).toEqual(["second-runtime"]);
  });

  it("UT-38 wahrt strikt zuerst geladen gewinnt bei umgekehrter Aktivierung", async () => {
    const calls: string[] = [];
    const harness = createPiHarness();
    const globalFirst = createProcessGuardedTrellisExtension(createTrellisExtension(dependencies("global", calls)));
    const projectSecond = createProcessGuardedTrellisExtension(createTrellisExtension(dependencies("project", calls)));

    globalFirst(harness.api);
    projectSecond(harness.api);
    await harness.sessionStart()({ reason: "startup" }, harness.context("/repo"));

    expect(calls).toEqual(["global"]);
  });
});

describe("UT-39 IT-17 Exakt-einmal-Hooks und pi-Resource-Ränge", () => {
  it("UT-39 IT-17 verarbeitet Trellis-Kontextblock, Review-Gate und Token-Usage aus Subagent- und Turn-Events exakt einmal", async () => {
    const calls: string[] = [];
    const harness = createPiHarness();
    const first = createProcessGuardedTrellisExtension(createTrellisExtension(dependencies("project", calls)));
    const duplicate = createProcessGuardedTrellisExtension(createTrellisExtension(dependencies("global", calls)));
    first(harness.api);
    duplicate(harness.api);
    const context = harness.context("/repo");
    await harness.sessionStart()({ reason: "startup" }, context);

    const injected = await harness.beforeAgentStart()({ systemPrompt: "base" }, context);
    expect(injected?.systemPrompt.match(/<trellis-context>/g)).toHaveLength(1);
    await expect(harness.toolCall()({
      toolCallId: "finish",
      toolName: "trellis_transition",
      input: { story_id: "US-17", action: "finish" },
    }, context)).resolves.toMatchObject({ block: true });

    expect(harness.eventSubscriptions.filter((name) => name === "subagents:completed")).toHaveLength(1);
    expect(harness.eventSubscriptions.filter((name) => name === "subagents:failed")).toHaveLength(1);
    await harness.turnStart()({ turnIndex: 0, timestamp: 0 }, context);
    harness.emitEvent("subagents:completed", { id: "review", usage: { totalTokens: 13 } });
    await harness.turnEnd()({
      turnIndex: 0,
      message: { role: "assistant", usage: { totalTokens: 17 } },
    }, context);
    await vi.waitFor(() => expect(harness.execCalls).toHaveLength(1));
    expect(harness.execCalls[0].args).toEqual([
      "usage", "add", "project-c325", "US-17", "--main", "17", "--subagents", "13",
    ]);

    expect(REVIEWERS).toHaveLength(5);
  });

  it("UT-39 belegt pi-Resource-Rang 0 der Settings-Extension vor Rang 4 des pi-Package", () => {
    let root = process.cwd();
    let packageManagerPath = "";
    while (dirname(root) !== root) {
      const candidate = join(
        root,
        "node_modules/@earendil-works/pi-coding-agent/dist/core/package-manager.js",
      );
      if (existsSync(candidate)) {
        packageManagerPath = candidate;
        break;
      }
      root = dirname(root);
    }
    expect(packageManagerPath).not.toBe("");
    const source = readFileSync(packageManagerPath, "utf8");
    expect(source).toContain("0  project + settings entry");
    expect(source).toContain("4  package resource");
    expect(source).toContain("resolved.sort((a, b) => resourcePrecedenceRank(a.metadata) - resourcePrecedenceRank(b.metadata))");
  });
});
