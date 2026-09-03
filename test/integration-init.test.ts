import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INTERVIEW_PROMPT } from "../src/init-prompt.js";
import { createTrellisExtension } from "../src/index.js";
import { ONBOARDING_INTERVIEW_PROMPT } from "../src/onboarding-prompt.js";
import { createPiHarness } from "./harness.js";

function expectInOrder(text: string, fragments: string[]): void {
  let cursor = -1;
  for (const fragment of fragments) {
    const next = text.indexOf(fragment, cursor + 1);
    expect(next, `${JSON.stringify(fragment)} fehlt nach Position ${cursor}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

async function runInitPaths(prefix: string): Promise<string[]> {
  const wiredRoot = await mkdtemp(join(tmpdir(), `${prefix}-wired-`));
  const newRoot = await mkdtemp(join(tmpdir(), `${prefix}-new-`));
  await writeFile(join(wiredRoot, "AGENTS.md"), "trellis-project: project-12\n", "utf8");

  const harness = createPiHarness();
  createTrellisExtension()(harness.api);
  await harness.commands.get("trellis:init")!("", harness.context(wiredRoot));
  await harness.commands.get("trellis:init")!("", harness.context(newRoot));
  return harness.userMessages as string[];
}

describe("IT-5 IT-12 Zustandserkennung des init-Commands im pi-Harness", () => {
  it("IT-5 IT-12 wählt für verdrahtete und neue Projekte jeweils genau einen Prompt", async () => {
    expect(await runInitPaths("pi-trellis-it12")).toEqual([
      INTERVIEW_PROMPT,
      ONBOARDING_INTERVIEW_PROMPT,
    ]);
  });

  it("IT-20 komponiert erweitertes Interview in beiden init-Pfaden genau einmal", async () => {
    const messages = await runInitPaths("pi-trellis-it20");
    expect(messages).toEqual([INTERVIEW_PROMPT, ONBOARDING_INTERVIEW_PROMPT]);
    expectInOrder(INTERVIEW_PROMPT, [
      "set_description",
      "Mehrere user activities?",
      "Backbone vorschlagen/bestätigen",
      "create_node kind=activity",
      "walking skeleton über alle user activities",
      "Liste vor create_node kind=story bestätigen",
      "Dann 3.",
      "Nein:",
      "Eine story map kann später ergänzt werden.",
      "2. Erste Features",
    ]);
    for (const message of messages) {
      expect(message.match(/mehrere user activities/gi)).toHaveLength(1);
    }
    expect(ONBOARDING_INTERVIEW_PROMPT.startsWith("Du führst zuerst den sicheren Onboarding-Modus")).toBe(true);
    expect(ONBOARDING_INTERVIEW_PROMPT.endsWith(INTERVIEW_PROMPT)).toBe(true);
  });

  it("IT-23 verbindet Activity-Erstellung, Approval und Placement-Recovery", async () => {
    const messages = await runInitPaths("pi-trellis-it23");
    for (const message of messages) {
      expectInOrder(message, [
        "create_node kind=activity",
        "Jede neue activity: get_node",
        "approve mit dessen content_hash",
        "danach erst placement via set_map_position/create_node",
      ]);
      expect(message).toMatch(
        /Benannte unapproved\/stale activity:[\s\S]*get_node[\s\S]*approve mit dessen content_hash[\s\S]*Placement einmal wiederholen, Folgefehler melden; nie blind/,
      );
    }
  });
});
