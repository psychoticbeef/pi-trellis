import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatFileHint, normalizeFilePath, projectPath, selectUnhintedDoneStories } from "../src/file-hints.js";
import { createTrellisExtension } from "../src/index.js";
import { createPiHarness } from "./harness.js";

const overview = {
  stories: [{ id: "US-3", title: "Current", status: "in_progress" }],
  stale_nodes: [],
};

describe("UT-5 Änderungserkennung, Auswahl, Format und Deduplizierung", () => {
  it("UT-5 normalisiert Projektpfade und formatiert den exakten Dateihinweis", () => {
    expect(normalizeFilePath("@src/index.ts", "/repo")).toBe("/repo/src/index.ts");
    expect(projectPath("/repo/src/index.ts", "/repo")).toBe("src/index.ts");
    expect(projectPath("/other/file.ts", "/repo")).toBe("/other/file.ts");
    expect(formatFileHint("src/index.ts", { id: "US-1", title: "Mode", status: "done" }))
      .toBe("Datei src/index.ts betrifft Story US-1 (Mode) – sind deren Specs/Tests noch aktuell?");
  });

  it("UT-5 wählt nur eindeutige noch nicht berücksichtigte Done-Storys", () => {
    const selected = selectUnhintedDoneStories([
      { id: "US-1", title: "One", status: "done" },
      { id: "US-1", title: "One", status: "done" },
      { id: "US-2", title: "Two", status: "in_progress" },
      { id: "US-4", title: "Four", status: "done" },
    ], new Set(["US-4"]));
    expect(selected.map((story) => story.id)).toEqual(["US-1"]);
  });

  it("UT-5 erkennt Änderungen, dedupliziert je Story und verwendet nextTurn ohne Turn-Trigger", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-trellis-ut5-"));
    await writeFile(join(root, "AGENTS.md"), "trellis-project: project-3\n", "utf8");
    const path = join(root, "src", "index.ts");
    const snapshots = new Map<string, string | undefined>([[path, "before"]]);
    let specsCalls = 0;
    const harness = createPiHarness();
    createTrellisExtension({
      getOverview: async () => overview,
      readFileSnapshot: async (file) => snapshots.get(file),
      specsForPath: async (_project, file) => {
        specsCalls += 1;
        expect(file).toBe("src/index.ts");
        return { stories: [
          { id: "US-1", title: "Mode", status: "done" },
          { id: "US-3", title: "Current", status: "in_progress" },
          { id: "US-4", title: "Status", status: "done" },
        ] };
      },
    })(harness.api);
    const context = harness.context(root);
    await harness.commands.get("trellis:on")!("", context);

    await harness.toolCall()({ toolCallId: "edit-1", toolName: "edit", input: { path: "src/index.ts" } }, context);
    snapshots.set(path, "after");
    await harness.toolResult()({ toolCallId: "edit-1", toolName: "edit", input: { path: "src/index.ts" }, isError: false }, context);

    const hints = harness.messages.filter((message) => message.customType === "trellis-file-hint");
    expect(hints.map((message) => message.content)).toEqual([
      "Datei src/index.ts betrifft Story US-1 (Mode) – sind deren Specs/Tests noch aktuell?",
      "Datei src/index.ts betrifft Story US-4 (Status) – sind deren Specs/Tests noch aktuell?",
    ]);
    expect(hints.every((message) => message.options?.deliverAs === "nextTurn")).toBe(true);
    expect(hints.every((message) => message.options?.triggerTurn === undefined)).toBe(true);

    await harness.toolCall()({ toolCallId: "write-2", toolName: "write", input: { path: path } }, context);
    snapshots.set(path, "again");
    await harness.toolResult()({ toolCallId: "write-2", toolName: "write", input: { path }, isError: false }, context);
    expect(harness.messages.filter((message) => message.customType === "trellis-file-hint")).toHaveLength(2);
    expect(specsCalls).toBe(2);
  });

  it("UT-5 unterdrückt unveränderte, fehlerhafte und im inaktiven Trellis-Modus ausgeführte Mutationen", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-trellis-ut5-none-"));
    await writeFile(join(root, "AGENTS.md"), "trellis-project: project-3\n", "utf8");
    const path = join(root, "same.ts");
    const snapshots = new Map<string, string | undefined>([[path, "same"]]);
    let specsCalls = 0;
    const harness = createPiHarness();
    createTrellisExtension({
      getOverview: async () => overview,
      readFileSnapshot: async (file) => snapshots.get(file),
      specsForPath: async () => { specsCalls += 1; return { stories: [] }; },
    })(harness.api);
    const context = harness.context(root);
    await harness.commands.get("trellis:on")!("", context);

    await harness.toolCall()({ toolCallId: "same", toolName: "edit", input: { path: "same.ts" } }, context);
    await harness.toolResult()({ toolCallId: "same", toolName: "edit", input: { path: "same.ts" }, isError: false }, context);

    await harness.toolCall()({ toolCallId: "error", toolName: "write", input: { path: "same.ts" } }, context);
    snapshots.set(path, "changed");
    await harness.toolResult()({ toolCallId: "error", toolName: "write", input: { path: "same.ts" }, isError: true }, context);

    await harness.commands.get("trellis:off")!("", context);
    await harness.toolCall()({ toolCallId: "off", toolName: "write", input: { path: "same.ts" } }, context);
    snapshots.set(path, "changed again");
    await harness.toolResult()({ toolCallId: "off", toolName: "write", input: { path: "same.ts" }, isError: false }, context);

    expect(specsCalls).toBe(0);
    expect(harness.messages.filter((message) => message.customType === "trellis-file-hint")).toHaveLength(0);
  });
});
