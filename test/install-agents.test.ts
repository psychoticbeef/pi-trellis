import { access, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { AGENT_RECIPES } from "../src/agent-recipes.js";

const root = fileURLToPath(new URL("..", import.meta.url));

async function installFixture(packageRoot: string): Promise<void> {
  await mkdir(packageRoot, { recursive: true });
  await cp(join(root, ".pi", "agents"), join(packageRoot, ".pi", "agents"), { recursive: true });
  await mkdir(join(packageRoot, "scripts"), { recursive: true });
  await cp(join(root, "scripts", "install-agents.mjs"), join(packageRoot, "scripts", "install-agents.mjs"));
}

function runInstall(packageRoot: string, environment: NodeJS.ProcessEnv): void {
  const result = spawnSync(process.execPath, [join(packageRoot, "scripts", "install-agents.mjs")], {
    env: { ...process.env, ...environment },
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
}

describe("UT-24 Geschütztes postinstall", () => {
  it.each(["git", "npm"])("UT-24 kopiert unter dem erlaubten %s-Pfad mit Overwrite", async (kind) => {
    const agentDir = await mkdtemp(join(tmpdir(), `pi-trellis-ut24-${kind}-`));
    const packageRoot = join(agentDir, kind, "pi-trellis");
    await installFixture(packageRoot);
    await mkdir(join(agentDir, "agents"), { recursive: true });
    await writeFile(join(agentDir, "agents", "spec-sync-check.md"), "stale\n");

    runInstall(packageRoot, { PI_CODING_AGENT_DIR: agentDir });

    for (const [name, content] of Object.entries(AGENT_RECIPES)) {
      expect(await readFile(join(agentDir, "agents", name), "utf8")).toBe(content);
    }
  });

  it("UT-24 nutzt ohne PI_CODING_AGENT_DIR den Home-Fallback", async () => {
    const home = await mkdtemp(join(tmpdir(), "pi-trellis-ut24-home-"));
    const agentDir = join(home, ".pi", "agent");
    const packageRoot = join(agentDir, "npm", "pi-trellis");
    await installFixture(packageRoot);

    runInstall(packageRoot, { HOME: home, PI_CODING_AGENT_DIR: "" });

    expect(await readFile(join(agentDir, "agents", "relic-hunter.md"), "utf8"))
      .toBe(AGENT_RECIPES["relic-hunter.md"]);
  });

  it("UT-24 ist außerhalb installierter Clone-Pfade ein No-op", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "pi-trellis-ut24-dev-"));
    const packageRoot = join(rootDir, "checkout");
    const agentDir = join(rootDir, "agent");
    await installFixture(packageRoot);

    runInstall(packageRoot, { PI_CODING_AGENT_DIR: agentDir });

    await expect(access(join(agentDir, "agents"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("UT-24 respektiert PI_TRELLIS_SKIP_AGENT_INSTALL vor jedem Schreibzugriff", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "pi-trellis-ut24-skip-"));
    const packageRoot = join(agentDir, "git", "pi-trellis");
    await installFixture(packageRoot);

    runInstall(packageRoot, {
      PI_CODING_AGENT_DIR: agentDir,
      PI_TRELLIS_SKIP_AGENT_INSTALL: "1",
    });

    await expect(access(join(agentDir, "agents"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
