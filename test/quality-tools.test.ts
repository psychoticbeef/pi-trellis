import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_RECIPES, ensureAgentRecipes } from "../src/agent-recipes.js";
import { CHECK_PROMPT } from "../src/check-prompt.js";
import { createTrellisExtension } from "../src/index.js";
import { buildReviewPrompt } from "../src/review-prompt.js";
import { createPiHarness } from "./harness.js";

const root = fileURLToPath(new URL("..", import.meta.url));

const requiredRelicCategories = [
  "auskommentierten Blöcken",
  "TODO-/FIXME-/HACK-Leichen",
  "Kommentaren",
  "ungenutztem Code, Imports und Dateien",
  "Done-Knoten",
  "Glossar-Terme ohne Verwendung",
  "deklarierte Story-Pfade",
];

describe("UT-14 Change-Review- und Relic-Hunter-Rezepte", () => {
  it("UT-14 begrenzt beide Rezepte auf read-only Werkzeuge und hält Projektkopien synchron", async () => {
    for (const name of ["change-review.md", "relic-hunter.md"] as const) {
      const recipe = AGENT_RECIPES[name];
      expect(recipe).toMatch(/^---\ndescription: .+\ntools: read, grep, find, bash\n---\n/);
      expect(recipe).toContain("read-only");
      expect(recipe).not.toMatch(/tools:.*\b(edit|write)\b/);
      expect(await readFile(join(root, ".pi", "agents", name), "utf8")).toBe(recipe);
    }
  });

  it("UT-14 beschreibt Diff-Quellen, Trellis-Inputs, Architekturprüfungen und konkrete Belege", () => {
    const recipe = AGENT_RECIPES["change-review.md"];
    for (const required of [
      "Git-Range unverändert",
      "Worktree-Diff",
      "get_overview",
      "Projekt-Description",
      "cross_cutting",
      "specs_for_path",
      "get_tree(full=true)",
      "Architektur-Specs",
      "Schichtverletzungen",
      "Cross-Cutting-Verstoß",
      "Diff-Pfad",
      "Spec-ID",
    ]) expect(recipe).toContain(required);
  });

  it("UT-14 führt Reliktmechanik zuerst aus und deckt alle Code- und Spec-Kategorien ab", () => {
    const recipe = AGENT_RECIPES["relic-hunter.md"];
    const tsc = recipe.indexOf("npx tsc --noUnusedLocals --noUnusedParameters");
    const knip = recipe.indexOf("npx knip");
    expect(tsc).toBeGreaterThan(-1);
    expect(knip).toBeGreaterThan(tsc);
    for (const required of requiredRelicCategories) expect(recipe).toContain(required);
    expect(recipe).toContain("Lösch-/Aktualisierungs-Vorschlagsliste");
    expect(recipe).toContain("Konfidenz");
  });

  it("UT-14 erhält ein vorhandenes neues Rezept bytegenau", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-trellis-ut14-"));
    await ensureAgentRecipes(cwd);
    const path = join(cwd, ".pi", "agents", "change-review.md");
    const custom = "custom review\n\u0000bytes\n";
    await writeFile(path, custom);
    await ensureAgentRecipes(cwd);
    expect(await readFile(path, "utf8")).toBe(custom);
  });
});

describe("UT-15 Review-Prompt, Range und Command-Guards", () => {
  it("UT-15 baut Default- und Range-Auftrag für einen Foreground-Spawn", () => {
    const fallback = buildReviewPrompt("");
    expect(fallback).toContain("change-review");
    expect(fallback).toContain("Foreground");
    expect(fallback).toContain("run_in_background: false");
    expect(fallback).toContain("Worktree-Diff einschließlich neuer Dateien");
    expect(fallback).toMatch(/Projekt-Description[\s\S]*cross_cutting[\s\S]*Architektur-Specs/);

    const range = "main..feature branch -- ; echo unverändert";
    const ranged = buildReviewPrompt(range);
    expect(ranged).toContain(JSON.stringify(range));
    expect(ranged).not.toContain("kein Git-Range");
  });

  it("UT-15 schützt trellis:review und sendet den Range genau einmal", async () => {
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-7\n",
      getOverview: async () => ({}),
      ensureAgentRecipes: async () => undefined,
    })(harness.api);

    expect(harness.commands.has("trellis:review")).toBe(true);
    await harness.commands.get("trellis:review")!("main..HEAD", harness.context("/repo"));
    expect(harness.userMessages).toHaveLength(0);
    expect(harness.messages.at(-1)?.content).toContain("/trellis:on");

    await harness.commands.get("trellis:on")!("", harness.context("/repo"));
    await harness.commands.get("trellis:review")!("main..HEAD", harness.context("/repo"));
    expect(harness.userMessages).toEqual([buildReviewPrompt("main..HEAD")]);
  });

  it("UT-15 verlangt drei parallele Prüfer und den vollständigen Inline-Fallback", () => {
    for (const required of [
      "spec-sync-check",
      "glossary-warden",
      "relic-hunter",
      "parallel",
      "gemeinsamen",
      "run_in_background: true",
      "specs_for_path",
      "get_tree(full=true)",
      "get_overview",
      "npx tsc --noUnusedLocals --noUnusedParameters",
      "npx knip",
      "inline",
    ]) expect(CHECK_PROMPT).toContain(required);
    for (const required of [
      "auskommentierten Blöcken",
      "TODO-Leichen",
      "veralteten Kommentaren",
      "Code, Imports und Dateien",
      "Done-Knoten",
      "Glossar-Termen ohne",
      "deklarierten Story-Pfaden",
    ]) expect(CHECK_PROMPT).toContain(required);
  });
});

describe("UT-16 Coverage-Abhängigkeit und LCOV-Lauf", () => {
  it("UT-16 deklariert und sperrt den kompatiblen V8-Coverage-Provider", async () => {
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
    };
    const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8")) as {
      packages: Record<string, { devDependencies?: Record<string, string>; version?: string }>;
    };
    const requested = manifest.devDependencies["@vitest/coverage-v8"];
    expect(requested).toMatch(/^\^3\.2\./);
    expect(lock.packages[""].devDependencies?.["@vitest/coverage-v8"]).toBe(requested);
    expect(lock.packages["node_modules/@vitest/coverage-v8"].version).toMatch(/^3\.2\./);
  });
});

describe("IT-7 Aktivierung, Qualitätsrezepte und Commands", () => {
  it("IT-7 provisioniert fünf Rezepte und versendet Review- und Drei-Prüfer-Prompt", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-trellis-it7-"));
    await writeFile(join(cwd, "AGENTS.md"), "trellis-project: project-7\n");
    const harness = createPiHarness();
    createTrellisExtension({ getOverview: async () => ({}) })(harness.api);

    await harness.commands.get("trellis:on")!("", harness.context(cwd));
    for (const [name, recipe] of Object.entries(AGENT_RECIPES)) {
      expect(await readFile(join(cwd, ".pi", "agents", name), "utf8")).toBe(recipe);
    }

    const range = "develop...HEAD";
    await harness.commands.get("trellis:review")!(range, harness.context(cwd));
    await harness.commands.get("trellis:check")!("", harness.context(cwd));
    expect(harness.userMessages).toEqual([buildReviewPrompt(range), CHECK_PROMPT]);
    expect(buildReviewPrompt(range)).toContain("run_in_background: false");
    expect(CHECK_PROMPT).toContain("run_in_background: true");
  });
});

describe("AT-7 End-to-End Qualitätswerkzeuge", () => {
  it("AT-7 erfüllt Review, Reliktsuche, parallelen Check und Coverage-Voraussetzung", async () => {
    expect(Object.keys(AGENT_RECIPES).sort()).toEqual([
      "change-review.md",
      "glossary-warden.md",
      "pre-finish-review.md",
      "relic-hunter.md",
      "spec-sync-check.md",
    ]);
    expect(buildReviewPrompt("")).toContain("Worktree-Diff");
    expect(buildReviewPrompt("")).toMatch(/change-review[\s\S]*Foreground/);
    expect(buildReviewPrompt("v1.0..HEAD")).toContain(JSON.stringify("v1.0..HEAD"));
    expect(AGENT_RECIPES["change-review.md"]).toMatch(/Description[\s\S]*Architektur-Specs[\s\S]*Schichtverletzungen/);
    expect(AGENT_RECIPES["relic-hunter.md"]).toMatch(/npx tsc[\s\S]*npx knip[\s\S]*Lösch-/);
    expect(CHECK_PROMPT).toMatch(/spec-sync-check[\s\S]*glossary-warden[\s\S]*relic-hunter[\s\S]*parallel/);

    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
    };
    expect(manifest.devDependencies["@vitest/coverage-v8"]).toMatch(/^\^3\.2\./);
  });
});
