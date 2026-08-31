import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import packageExtension from "../extensions/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("AT-4 Installierbares und dokumentiertes pi-Package", () => {
  it("AT-4 liefert ein buildfreies Package mit Peer-Metadaten und vollständigem README", async () => {
    expect(typeof packageExtension).toBe("function");

    const packed = JSON.parse(execFileSync(
      "npm",
      ["pack", "--dry-run", "--json", "--ignore-scripts"],
      { cwd: root, encoding: "utf8" },
    )) as Array<{ files: Array<{ path: string }> }>;
    const files = packed[0].files.map((file) => file.path);
    expect(files).toContain("extensions/index.ts");
    expect(files).toContain("src/index.ts");
    expect(files).toContain("README.md");
    expect(files.some((path) => path === "dist" || path.startsWith("dist/"))).toBe(false);

    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      peerDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
      bundledDependencies?: string[];
    };
    expect(packageJson.peerDependencies?.["@earendil-works/pi-coding-agent"]).toBe("*");
    expect(packageJson.dependencies?.["@earendil-works/pi-coding-agent"]).toBeUndefined();
    expect(packageJson.bundledDependencies ?? []).not.toContain("@earendil-works/pi-coding-agent");

    const readme = await readFile(join(root, "README.md"), "utf8");
    for (const required of [
      "pi -e /absolute/path/to/pi-trellis",
      '"packages"',
      "/trellis:on",
      "/trellis:off",
      "/trellis:status",
      "Trellis-Kontextblock",
      "Dateihinweis",
    ]) expect(readme).toContain(required);
  });

  it("AT-14 packt postinstall und alle kanonischen Subagent-Rezepte", () => {
    const packed = JSON.parse(execFileSync(
      "npm",
      ["pack", "--dry-run", "--json", "--ignore-scripts"],
      { cwd: root, encoding: "utf8" },
    )) as Array<{ files: Array<{ path: string }> }>;
    const files = packed[0].files.map((file) => file.path);
    expect(files).toContain("scripts/install-agents.mjs");
    for (const name of [
      "change-review.md",
      "glossary-warden.md",
      "pre-finish-review.md",
      "relic-hunter.md",
      "spec-sync-check.md",
    ]) expect(files).toContain(`.pi/agents/${name}`);
  });
});
