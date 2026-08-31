import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("UT-8 UT-25 README-Pflichtinhalte", () => {
  it("UT-8 dokumentiert Installation, Commands, Trellis-Kontextblock und Dateihinweis", async () => {
    const readme = await readFile(join(root, "README.md"), "utf8");
    expect(readme).toContain("pi -e /absolute/path/to/pi-trellis");
    expect(readme).toContain('"packages": ["/absolute/path/to/pi-trellis"]');
    for (const command of ["/trellis:on", "/trellis:off", "/trellis:status"]) {
      expect(readme).toContain(command);
    }
    expect(readme).toContain("Trellis-Kontextblock");
    expect(readme).toContain("Dateihinweis");
  });

  it("UT-25 dokumentiert automatische globale Subagent-Rezepte und Nutzer-Overrides", async () => {
    const readme = await readFile(join(root, "README.md"), "utf8");
    expect(readme).toContain("postinstall");
    expect(readme).toContain("<agent-dir>/agents");
    expect(readme).toContain("pi update --extensions");
    expect(readme).toContain("PI_CODING_AGENT_DIR");
    expect(readme).toContain("PI_TRELLIS_SKIP_AGENT_INSTALL=1");
    expect(readme).toMatch(/Projektlokale `.pi\/agents\/\*\.md`.*Nutzer-Overrides.*Vorrang/);
    expect(readme).not.toContain(".pi/agents/*.md` committen");
  });
});
