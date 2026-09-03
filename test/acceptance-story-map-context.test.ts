import { describe, expect, it } from "vitest";
import { formatTrellisContext, MAX_CONTEXT_LENGTH } from "../src/context.js";
import { createTrellisExtension } from "../src/index.js";
import { createPiHarness } from "./harness.js";

describe("US-19 map line im Trellis-Kontextblock", () => {
  it("AT-33 IT-19 zeigt Positionsreihenfolge, niedrigsten offenen Slice und unmapped-Anzahl", async () => {
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-1\n",
      getOverview: async () => ({
        activities: [
          { id: "UA-1", title: "Explore", position: 1 },
          { id: "UA-2", title: "Buy", position: 2 },
        ],
        story_map: {
          status: "1 unmapped",
          unmapped_story_ids: ["US-7"],
          groups: [
            {
              activity: { id: "UA-1", title: "Explore", position: 1 },
              stories: [],
              slice_progress: [
                { slice: 1, done: 1, total: 1 },
                { slice: 2, done: 0, total: 2 },
              ],
            },
            {
              activity: { id: "UA-2", title: "Buy", position: 2 },
              stories: [],
              slice_progress: [{ slice: 1, done: 1, total: 3 }],
            },
            { unmapped: true, stories: [{ id: "US-7", title: "Legacy", status: "todo" }] },
          ],
          gaps: [{ activity_id: "UA-2", slice: 2 }],
        },
        stories: [{ id: "US-19", title: "Map line", status: "in_progress" }],
      }),
    })(harness.api);
    const context = harness.context("/project/.trellis-worktrees/US-19");

    await harness.commands.get("trellis:on")!("", context);
    const result = await harness.beforeAgentStart()({ systemPrompt: "base" }, context);

    expect(result?.systemPrompt).toContain("Map: Explore 0/2; Buy 1/3; unmapped 1");
    expect(result?.systemPrompt.match(/^Map:/gm)).toHaveLength(1);
    expect(result!.systemPrompt.length).toBeLessThan(MAX_CONTEXT_LENGTH + "base\n\n".length);
  });

  it("AT-34 IT-19 hält bisherigen Block ohne story_map byte-identisch", () => {
    expect(formatTrellisContext({
      description: "Existing",
      stories: [{ id: "US-1", title: "Done", status: "done" }],
    })).toBe([
      "<trellis-context>",
      "Description: Existing",
      "Glossar: none",
      "Kanban: todo=0 refined=0 in_progress=0 done=1",
      "in_progress: none",
      "stale: none",
      "</trellis-context>",
    ].join("\n"));
  });

  it("AT-33 IT-19 begrenzt überlange map line deterministisch", () => {
    const overview = {
      story_map: {
        unmapped_story_ids: ["US-999"],
        groups: Array.from({ length: 100 }, (_, index) => ({
          activity: { id: `UA-${index}`, title: `Activity ${index} ${"z".repeat(200)}`, position: index },
          slice_progress: [{ slice: 1, done: 0, total: 10 }],
        })),
      },
    };

    expect(() => formatTrellisContext(overview)).not.toThrow();
    const block = formatTrellisContext(overview);
    expect(block).toContain("…(+");
    expect(block.length).toBeLessThan(MAX_CONTEXT_LENGTH);
  });
});
