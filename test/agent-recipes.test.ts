import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_RECIPES, ensureAgentRecipes } from "../src/agent-recipes.js";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("UT-11 UT-23 Rezeptdateien und globaler create-if-absent-Fallback", () => {
  it("UT-11 UT-23 lädt gültige read-only Rezepte ausschließlich aus den Markdown-Dateien", async () => {
    expect(Object.keys(AGENT_RECIPES).sort()).toEqual([
      "change-review.md",
      "glossary-warden.md",
      "pre-finish-review.md",
      "relic-hunter.md",
      "spec-sync-check.md",
    ]);

    for (const [name, content] of Object.entries(AGENT_RECIPES)) {
      expect(content).toMatch(/^---\ndescription: .+\ntools: read, grep, find, bash\n---\n/);
      expect(content).toContain("read-only");
      expect(content).not.toMatch(/tools:.*\b(edit|write)\b/);
      expect(await readFile(join(root, ".pi", "agents", name), "utf8")).toBe(content);
    }

    const source = await readFile(join(root, "src", "agent-recipes.ts"), "utf8");
    expect(source).toContain('new URL("../.pi/agents/", import.meta.url)');
    expect(source).not.toContain("Du bist der read-only");
    expect(AGENT_RECIPES["spec-sync-check.md"]).toMatch(/Diff[\s\S]*Done-Bäume[\s\S]*Vorschlagsliste/);
  });

  it("UT-11 UT-23 priorisiert Projekt und global und schreibt nur fehlende Rezepte global", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-trellis-ut23-project-"));
    const agentDir = await mkdtemp(join(tmpdir(), "pi-trellis-ut23-agent-"));
    const projectAgents = join(cwd, ".pi", "agents");
    const globalAgents = join(agentDir, "agents");
    await mkdir(projectAgents, { recursive: true });
    await mkdir(globalAgents, { recursive: true });

    const projectOverride = Buffer.from("project-owned\n\u0000bytes\n", "utf8");
    const globalOverride = Buffer.from("global-owned\n\u0000bytes\n", "utf8");
    await writeFile(join(projectAgents, "spec-sync-check.md"), projectOverride);
    await writeFile(join(globalAgents, "glossary-warden.md"), globalOverride);

    const environment = { PI_CODING_AGENT_DIR: agentDir };
    await Promise.all([
      ensureAgentRecipes(cwd, environment),
      ensureAgentRecipes(cwd, environment),
    ]);

    expect(await readFile(join(projectAgents, "spec-sync-check.md"))).toEqual(projectOverride);
    expect(await readFile(join(globalAgents, "glossary-warden.md"))).toEqual(globalOverride);
    expect(await readFile(join(globalAgents, "pre-finish-review.md"), "utf8"))
      .toBe(AGENT_RECIPES["pre-finish-review.md"]);
    await expect(access(join(projectAgents, "pre-finish-review.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
