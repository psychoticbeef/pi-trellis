import { describe, expect, it } from "vitest";
import type { TrellisOverview } from "../src/context.js";
import { createTrellisExtension } from "../src/index.js";
import { STORY_MAP_RETROFIT_NOTICE } from "../src/story-prompt.js";
import { createPiHarness } from "./harness.js";

const tenStories = Array.from({ length: 10 }, (_, index) => ({
  id: `US-${index + 1}`,
  title: `Story ${index + 1}`,
  status: "done",
}));

async function activate(
  overview: () => Promise<TrellisOverview>,
) {
  const harness = createPiHarness();
  createTrellisExtension({
    readTextFile: async () => "trellis-project: project-21\n",
    getOverview: overview,
  })(harness.api);
  const context = harness.context("/project");
  await harness.commands.get("trellis:on")!("", context);
  return { harness, context };
}

describe("UT-48 trellis:story Command und Sitzungsstatus", () => {
  it("UT-48 registriert Command und lehnt Leerargument sowie inaktiven Modus konkret ab", async () => {
    const harness = createPiHarness();
    createTrellisExtension()(harness.api);
    const context = harness.context("/project");

    expect(harness.commandRegistrations).toContain("trellis:story");
    await harness.commands.get("trellis:story")!("   ", context);
    await harness.commands.get("trellis:story")!("Suche", context);

    expect(harness.messages.map((message) => message.content)).toEqual([
      "Usage: /trellis:story <Feature-Idee>",
      "/trellis:story erfordert einen aktiven Trellis-Modus. Führe zuerst /trellis:on aus.",
    ]);
    expect(harness.userMessages).toHaveLength(0);
  });

  it("UT-48 sendet bei Overview-Fehler keinen User-Turn und setzt Erinnerung nicht", async () => {
    let calls = 0;
    const { harness, context } = await activate(async () => {
      calls += 1;
      if (calls > 1) throw new Error("offline");
      return { stories: tenStories };
    });

    await harness.commands.get("trellis:story")!("Suche", context);

    expect(harness.userMessages).toHaveLength(0);
    expect(harness.messages.at(-1)?.content).toBe("/trellis:story nicht verfügbar: offline");
  });

  it("UT-48 erkennt story map und bewahrt Feature-Idee im einzigen User-Turn", async () => {
    const overview = {
      story_map: { groups: [], gaps: [] },
      stories: tenStories,
    };
    const { harness, context } = await activate(async () => overview);
    const featureIdea = "  Händler-Export  ";

    await harness.commands.get("trellis:story")!(featureIdea, context);

    expect(harness.userMessages).toHaveLength(1);
    expect(harness.userMessages[0]).toContain(`Feature-Idee (wortgetreu):\n${featureIdea}`);
    expect(harness.userMessages[0]).toContain("höchstens drei nummerierte placement proposals");
    expect(harness.userMessages[0]).not.toContain(STORY_MAP_RETROFIT_NOTICE);
  });

  it("UT-48 erwähnt Nachrüstung ab zehn Stories einmal und setzt Status bei session_start zurück", async () => {
    let overview: TrellisOverview = { stories: tenStories.slice(0, 9) };
    const { harness, context } = await activate(async () => overview);
    const command = harness.commands.get("trellis:story")!;

    await command("Neun", context);
    overview = { stories: tenStories };
    await command("Zehn A", context);
    await command("Zehn B", context);
    expect(harness.userMessages.map(String).join("\n").match(/story map nachgerüstet/g)).toHaveLength(1);

    await harness.sessionStart()({ reason: "reload" }, context);
    await command("Zehn C", context);
    expect(harness.userMessages.map(String).join("\n").match(/story map nachgerüstet/g)).toHaveLength(2);
  });
});
