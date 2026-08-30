import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_RECIPES } from "../src/agent-recipes.js";
import { CHECK_PROMPT } from "../src/check-prompt.js";
import { createTrellisExtension } from "../src/index.js";
import { createPiHarness } from "./harness.js";

describe("IT-6 Aktivierung, Provisionierung und Check im Pi-Harness", () => {
  it("IT-6 verbindet Aktivierung, create-if-absent und Check-Prompt", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-trellis-it6-"));
    await writeFile(join(cwd, "AGENTS.md"), "trellis-project: project-6\n");
    await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
    await writeFile(join(cwd, ".pi", "agents", "glossary-warden.md"), "keep\n");

    const harness = createPiHarness();
    createTrellisExtension({ getOverview: async () => ({}) })(harness.api);
    await harness.commands.get("trellis:on")!("", harness.context(cwd));

    expect(await readFile(join(cwd, ".pi", "agents", "glossary-warden.md"), "utf8"))
      .toBe("keep\n");
    expect(await readFile(join(cwd, ".pi", "agents", "spec-sync-check.md"), "utf8"))
      .toBe(AGENT_RECIPES["spec-sync-check.md"]);
    expect(await readFile(join(cwd, ".pi", "agents", "pre-finish-review.md"), "utf8"))
      .toBe(AGENT_RECIPES["pre-finish-review.md"]);
    expect(await readFile(join(cwd, ".pi", "agents", "change-review.md"), "utf8"))
      .toBe(AGENT_RECIPES["change-review.md"]);
    expect(await readFile(join(cwd, ".pi", "agents", "relic-hunter.md"), "utf8"))
      .toBe(AGENT_RECIPES["relic-hunter.md"]);

    await harness.commands.get("trellis:check")!("", harness.context(cwd));
    expect(harness.userMessages).toEqual([CHECK_PROMPT]);
    expect(CHECK_PROMPT).toContain("relic-hunter");
  });
});
