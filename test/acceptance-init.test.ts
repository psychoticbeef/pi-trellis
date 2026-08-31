import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INTERVIEW_PROMPT } from "../src/init-prompt.js";
import { createTrellisExtension } from "../src/index.js";
import { ONBOARDING_INTERVIEW_PROMPT, ONBOARDING_PROMPT } from "../src/onboarding-prompt.js";
import { createPiHarness } from "./harness.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const missing = Object.assign(new Error("missing"), { code: "ENOENT" });

describe("AT-5 AT-15 Geführtes Onboarding und Projekt-Interview", () => {
  it("AT-5 AT-15 wählt zustandsabhängig Onboarding oder unverändertes Interview", async () => {
    const wired = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-5\n",
    })(wired.api);
    await wired.commands.get("trellis:init")!("", wired.context("/wired"));
    expect(wired.userMessages).toEqual([INTERVIEW_PROMPT]);

    const fresh = createPiHarness();
    createTrellisExtension({ readTextFile: async () => Promise.reject(missing) })(fresh.api);
    await fresh.commands.get("trellis:init")!("", fresh.context("/fresh"));
    expect(fresh.userMessages).toEqual([ONBOARDING_INTERVIEW_PROMPT]);
    expect(ONBOARDING_INTERVIEW_PROMPT.endsWith(INTERVIEW_PROMPT)).toBe(true);
  });

  it("AT-15 deckt sichere Reihenfolge, Gate-Rezepte, CLI-Grenze und Doctor-Abnahme ab", () => {
    const required = [
      "Repository verstehen",
      "Zweck, Sprache und Stack",
      "git init -b develop",
      "ausschließlich fehlende Dateien",
      "Committe danach ALLE",
      "bevor du trellis init ausführst",
      "trellis init --name",
      "npx vitest run --reporter=junit",
      "gotestsum --junitfile",
      "pytest --junitxml",
      "trellis config",
      "niemals über MCP",
      "trellis doctor",
      "LCOV oder Go-coverprofile",
    ];
    for (const item of required) expect(ONBOARDING_PROMPT).toContain(item);
  });

  it("AT-15 dokumentiert Onboarding und manuellen Fallback", async () => {
    const readme = await readFile(join(root, "README.md"), "utf8");
    expect(readme).toMatch(/\/trellis:init[\s\S]*Onboarding/);
    expect(readme).toMatch(/Manueller Fallback[\s\S]*trellis init[\s\S]*trellis config[\s\S]*trellis doctor/);
  });
});
