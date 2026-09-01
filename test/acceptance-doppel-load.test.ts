import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createProcessGuardedTrellisExtension,
  createTrellisExtension,
  TRELLIS_EXTENSION_OWNER_KEY,
} from "../src/index.js";
import { createPiHarness } from "./harness.js";

const registry = globalThis as typeof globalThis & Record<symbol, unknown>;
const resetOwner = () => { delete registry[TRELLIS_EXTENSION_OWNER_KEY]; };

beforeEach(resetOwner);
afterEach(resetOwner);

describe("AT-28 Doppel-Load bleibt sichtbarer No-op mit erster Instanz als Besitzerin", () => {
  it("AT-28 lässt projektlokale Erstladung allein registrieren und über Sessions aktiv", async () => {
    const owners: string[] = [];
    const make = (owner: string) => createProcessGuardedTrellisExtension(createTrellisExtension({
      readTextFile: async () => "trellis-project: project-c325\n",
      getOverview: async () => {
        owners.push(owner);
        return { description: owner, stories: [{ id: "US-17", status: "in_progress" }] };
      },
      ensureAgentRecipes: async () => {},
    }));
    const harness = createPiHarness();

    make("project-rank-0")(harness.api);
    const commandCount = harness.commandRegistrations.length;
    const hookCount = harness.hookRegistrations.length;
    const eventCount = harness.eventSubscriptions.length;
    make("package-rank-4")(harness.api);

    expect(harness.commandRegistrations).toHaveLength(commandCount);
    expect(harness.hookRegistrations).toHaveLength(hookCount);
    expect(harness.eventSubscriptions).toHaveLength(eventCount);
    expect(harness.commandRegistrations.some((name) => /:\d+$/.test(name))).toBe(false);

    const context = harness.context("/repo");
    await harness.sessionStart()({ reason: "startup" }, context);
    expect(owners).toEqual(["project-rank-0"]);
    expect(harness.notifications).toContainEqual({
      message: "Doppel-Load erkannt; zweite pi-trellis-Instanz übersprungen.",
      level: "info",
    });

    const prompt = await harness.beforeAgentStart()({ systemPrompt: "base" }, context);
    expect(prompt?.systemPrompt).toContain("Description: project-rank-0");
    await harness.sessionStart()({ reason: "new" }, context);
    expect(owners).toEqual(["project-rank-0", "project-rank-0", "project-rank-0"]);
  });

  it("AT-28 lässt bei umgekehrter direkter Reihenfolge globale Instanz gewinnen", async () => {
    const owners: string[] = [];
    const harness = createPiHarness();
    const make = (owner: string) => createProcessGuardedTrellisExtension(createTrellisExtension({
      readTextFile: async () => "trellis-project: project-c325\n",
      getOverview: async () => { owners.push(owner); return { description: owner }; },
      ensureAgentRecipes: async () => {},
    }));

    make("global-first")(harness.api);
    make("project-second")(harness.api);
    await harness.sessionStart()({ reason: "startup" }, harness.context("/repo"));

    expect(owners).toEqual(["global-first"]);
  });
});
