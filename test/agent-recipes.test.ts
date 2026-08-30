import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_RECIPES, ensureAgentRecipes } from "../src/agent-recipes.js";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("UT-11 Rezeptformat, Rollen und create-if-absent", () => {
  it("UT-11 liefert gültige read-only Templates mit allen Rollen", async () => {
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

    expect(AGENT_RECIPES["spec-sync-check.md"]).toMatch(/Diff[\s\S]*Done-Bäume[\s\S]*Vorschlagsliste/);
    expect(AGENT_RECIPES["glossary-warden.md"]).toMatch(/Specs und Code[\s\S]*Glossar[\s\S]*Terminologie-Drift/);
    expect(AGENT_RECIPES["pre-finish-review.md"]).toMatch(/Worktree-Diff[\s\S]*Akzeptanzkriterien[\s\S]*Checkliste/);
  });

  it("UT-11 legt nur fehlende Rezepte an und erhält Vorbestand bytegenau", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-trellis-ut11-"));
    await ensureAgentRecipes(cwd);

    for (const [name, content] of Object.entries(AGENT_RECIPES)) {
      expect(await readFile(join(cwd, ".pi", "agents", name), "utf8")).toBe(content);
    }

    const preservedPath = join(cwd, ".pi", "agents", "spec-sync-check.md");
    const preserved = Buffer.from("user-owned\n\u0000bytes\n", "utf8");
    await writeFile(preservedPath, preserved);
    await Promise.all([ensureAgentRecipes(cwd), ensureAgentRecipes(cwd)]);

    expect(await readFile(preservedPath)).toEqual(preserved);
    expect(await readFile(join(cwd, ".pi", "agents", "glossary-warden.md"), "utf8"))
      .toBe(AGENT_RECIPES["glossary-warden.md"]);
  });
});
