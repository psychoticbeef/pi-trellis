import { access, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { AGENT_RECIPES, ensureAgentRecipes } from "../src/agent-recipes.js";

const root = fileURLToPath(new URL("..", import.meta.url));

async function unpackPiPackage(target: string, packDirectory: string): Promise<void> {
  const packed = JSON.parse(execFileSync(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", packDirectory],
    { cwd: root, encoding: "utf8" },
  )) as Array<{ filename: string }>;
  await mkdir(target, { recursive: true });
  execFileSync("tar", [
    "-xzf",
    join(packDirectory, packed[0].filename),
    "-C",
    target,
    "--strip-components=1",
  ]);
}

function postinstall(packageRoot: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync("npm", ["run", "postinstall"], {
    cwd: packageRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
}

describe("AT-14 Automatisch verfügbare globale Subagent-Rezepte", () => {
  it("AT-14 installiert kanonisch global, schützt Dev-Repos und hält Zielprojekte sauber", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "pi-trellis-at14-"));
    const agentDir = join(sandbox, "agent");
    const installedPackage = join(agentDir, "git", "pi-trellis");
    await unpackPiPackage(installedPackage, sandbox);
    await mkdir(join(agentDir, "agents"), { recursive: true });
    await writeFile(join(agentDir, "agents", "change-review.md"), "old\n");

    postinstall(installedPackage, { PI_CODING_AGENT_DIR: agentDir });
    expect(await readFile(join(agentDir, "agents", "change-review.md"), "utf8"))
      .toBe(AGENT_RECIPES["change-review.md"]);

    const npmPackage = join(agentDir, "npm", "pi-trellis");
    await cp(installedPackage, npmPackage, { recursive: true });
    await writeFile(join(agentDir, "agents", "change-review.md"), "npm-stale\n");
    postinstall(npmPackage, { PI_CODING_AGENT_DIR: agentDir });
    expect(await readFile(join(agentDir, "agents", "change-review.md"), "utf8"))
      .toBe(AGENT_RECIPES["change-review.md"]);

    await writeFile(join(agentDir, "agents", "change-review.md"), "skip-keeps-this\n");
    postinstall(npmPackage, {
      PI_CODING_AGENT_DIR: agentDir,
      PI_TRELLIS_SKIP_AGENT_INSTALL: "1",
    });
    expect(await readFile(join(agentDir, "agents", "change-review.md"), "utf8"))
      .toBe("skip-keeps-this\n");

    const devPackage = join(sandbox, "dev-checkout");
    const untouchedAgentDir = join(sandbox, "untouched-agent");
    await cp(installedPackage, devPackage, { recursive: true });
    postinstall(devPackage, { PI_CODING_AGENT_DIR: untouchedAgentDir });
    await expect(access(join(untouchedAgentDir, "agents"))).rejects.toMatchObject({ code: "ENOENT" });

    const project = join(sandbox, "target-project");
    const fallbackAgentDir = join(sandbox, "fallback-agent");
    await mkdir(project, { recursive: true });
    await ensureAgentRecipes(project, { PI_CODING_AGENT_DIR: fallbackAgentDir });
    expect(await readFile(join(fallbackAgentDir, "agents", "relic-hunter.md"), "utf8"))
      .toBe(AGENT_RECIPES["relic-hunter.md"]);
    await expect(access(join(project, ".pi"))).rejects.toMatchObject({ code: "ENOENT" });

    const readme = await readFile(join(root, "README.md"), "utf8");
    expect(readme).toMatch(/postinstall[\s\S]*global[\s\S]*pi update --extensions/);
    expect(await readFile(join(root, ".pi", "agents", "relic-hunter.md"), "utf8"))
      .toBe(AGENT_RECIPES["relic-hunter.md"]);
  });
});
