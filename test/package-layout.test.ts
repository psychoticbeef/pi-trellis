import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

async function manifest(): Promise<Record<string, any>> {
  return JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Record<string, any>;
}

describe("UT-7 Package-Layout und Manifestregeln", () => {
  it("UT-7 deklariert das Konventionsentry und pi-package", async () => {
    const packageJson = await manifest();
    expect(packageJson.keywords).toContain("pi-package");
    expect(packageJson.pi?.extensions).toEqual(["./extensions"]);
    await expect(readFile(join(root, "extensions", "index.ts"), "utf8")).resolves.toContain(
      'export { default } from "../src/index.js"',
    );
    expect(packageJson.scripts?.build).toBeUndefined();
    expect(JSON.stringify(packageJson.pi)).not.toContain("dist");
  });

  it("UT-7 hält pi-Core-Pakete als ungebündelte Peers", async () => {
    const packageJson = await manifest();
    const corePackages = ["@earendil-works/pi-coding-agent"];
    for (const name of corePackages) {
      expect(packageJson.peerDependencies?.[name]).toBe("*");
      expect(packageJson.dependencies?.[name]).toBeUndefined();
      expect(packageJson.bundledDependencies ?? []).not.toContain(name);
    }
  });

  it("UT-24 paketiert plain-ESM-postinstall und kanonische Rezeptdateien", async () => {
    const packageJson = await manifest();
    expect(packageJson.scripts?.postinstall).toBe("node scripts/install-agents.mjs");
    expect(packageJson.files).toContain("scripts/install-agents.mjs");
    expect(packageJson.files).toContain(".pi/agents");
    await expect(readFile(join(root, "scripts", "install-agents.mjs"), "utf8"))
      .resolves.toContain("PI_TRELLIS_SKIP_AGENT_INSTALL");
  });
});
