import { describe, expect, it } from "vitest";
import type { TrellisOverview } from "../src/context.js";
import { createTrellisExtension } from "../src/index.js";
import { STORY_MAP_RETROFIT_NOTICE } from "../src/story-prompt.js";
import { createPiHarness } from "./harness.js";

async function runningStoryCommand(overview: () => Promise<TrellisOverview>) {
  const harness = createPiHarness();
  createTrellisExtension({
    readTextFile: async () => "trellis-project: project-21\n",
    getOverview: overview,
  })(harness.api);
  const context = harness.context("/project");
  await harness.commands.get("trellis:on")!("", context);
  return {
    harness,
    context,
    run: (idea: string) => harness.commands.get("trellis:story")!(idea, context),
  };
}

describe("US-21 Feature-Dialog mit placement proposals", () => {
  it("AT-37 IT-21 fordert Optionen aus story map und gewähltes placement vor jeder Story-Erstellung", async () => {
    const { harness, run } = await runningStoryCommand(async () => ({
      story_map: {
        groups: [
          {
            activity: { id: "UA-1", title: "Kaufen", position: 1 },
            slice_progress: [{ slice: 1, done: 1, total: 1 }],
          },
          {
            activity: { id: "UA-2", title: "Nutzen", position: 2 },
            slice_progress: [{ slice: 1, done: 0, total: 1 }],
          },
        ],
        gaps: [{ activity_id: "UA-1", slice: 2 }],
      },
      stories: [],
    }));

    await run("Großer Händler-Export");

    expect(harness.userMessages).toHaveLength(1);
    const prompt = String(harness.userMessages[0]);
    expect(prompt).toMatch(/get_overview[\s\S]*Erstelle noch nichts[\s\S]*höchstens drei nummerierte placement proposals/);
    expect(prompt).toMatch(/activity, slice und erkennbare gaps[\s\S]*Aufteilung in genau zwei Stories/);
    expect(prompt).toMatch(/Vor ausdrücklicher Auswahl kein create_node[\s\S]*create_node kind=story[\s\S]*gewählte activity und slice/);
  });

  it("AT-38 IT-22 erwähnt Nachrüstung ohne story map ab zehn Stories einmal je Sitzung", async () => {
    const stories = Array.from({ length: 10 }, (_, index) => ({
      id: `US-${index + 1}`,
      status: "done",
    }));
    const { harness, context, run } = await runningStoryCommand(async () => ({ stories }));

    await run("Suche");
    await run("Export");
    expect(harness.userMessages.filter((message) => String(message).includes(STORY_MAP_RETROFIT_NOTICE)))
      .toHaveLength(1);

    await harness.sessionStart()({ reason: "new" }, context);
    await run("Import");
    expect(harness.userMessages.filter((message) => String(message).includes(STORY_MAP_RETROFIT_NOTICE)))
      .toHaveLength(2);

    const belowThreshold = await runningStoryCommand(async () => ({ stories: stories.slice(0, 9) }));
    await belowThreshold.run("Unter Schwelle");
    expect(belowThreshold.harness.userMessages[0]).not.toContain(STORY_MAP_RETROFIT_NOTICE);

    const mapped = await runningStoryCommand(async () => ({
      story_map: { groups: [], gaps: [] },
      stories,
    }));
    await mapped.run("Mit story map");
    expect(mapped.harness.userMessages[0]).not.toContain(STORY_MAP_RETROFIT_NOTICE);
  });

  it("AT-39 IT-22 wandelt Placement-Gate-Kandidaten in Auswahl um statt blindem Retry", async () => {
    const { harness, run } = await runningStoryCommand(async () => ({
      story_map: { groups: [], gaps: [] },
      stories: [],
    }));

    await run("Suche");

    const prompt = String(harness.userMessages[0]);
    expect(prompt).toMatch(
      /Placement-Gate-Fehler[\s\S]*Kandidaten[\s\S]*create_node nicht erneut[\s\S]*nummerierte placement proposals[\s\S]*nenne gaps[\s\S]*warte auf neue User-Auswahl/,
    );
    expect(prompt).toMatch(/Erst danach[\s\S]*create_node kind=story[\s\S]*gewählter activity und slice/);
  });
});
