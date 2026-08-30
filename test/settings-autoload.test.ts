import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
const root = fileURLToPath(new URL("..", import.meta.url));

describe("UT-13 Settings-Format und Extension-Pfad", () => {
  it("UT-13 lädt den Package-Entry relativ zu den Projekteinstellungen", async () => {
    const settingsPath = join(root, ".pi", "settings.json");
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as { extensions?: string[] };

    expect(settings).toEqual({ extensions: ["../extensions/index.ts"] });
    expect(resolve(dirname(settingsPath), settings.extensions![0]))
      .toBe(join(root, "extensions", "index.ts"));
  });
});

describe("AT-6 IT-6 Projektlokales Auto-Load im echten pi-Prozess", () => {
  it("AT-6 IT-6 registriert alle Trellis-Commands ohne -e", async () => {
    const commands = await getProjectCommands();
    expect(commands).toEqual(expect.arrayContaining([
      "trellis:check",
      "trellis:init",
      "trellis:off",
      "trellis:on",
      "trellis:review",
      "trellis:status",
    ]));
  }, 15_000);
});

async function getProjectCommands(): Promise<string[]> {
  const child = spawn(
    "pi",
    ["--mode", "rpc", "--approve", "--offline", "--no-session"],
    { cwd: root, env: { ...process.env, PI_SKIP_VERSION_CHECK: "1" }, stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  try {
    return await new Promise<string[]>((resolvePromise, reject) => {
      const timeout = setTimeout(() => reject(new Error(`pi RPC timeout: ${stderr}`)), 10_000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
        while (stdout.includes("\n")) {
          const newline = stdout.indexOf("\n");
          const line = stdout.slice(0, newline).replace(/\r$/, "");
          stdout = stdout.slice(newline + 1);
          if (!line) continue;
          const event = JSON.parse(line) as {
            id?: string;
            success?: boolean;
            error?: string;
            data?: { commands?: Array<{ name: string }> };
          };
          if (event.id !== "commands") continue;
          clearTimeout(timeout);
          if (!event.success) reject(new Error(event.error ?? "get_commands failed"));
          else resolvePromise((event.data?.commands ?? []).map((command) => command.name));
        }
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("exit", (code) => {
        if (code !== null) {
          clearTimeout(timeout);
          reject(new Error(`pi RPC exited ${code}: ${stderr}`));
        }
      });
      child.stdin.write(`${JSON.stringify({ id: "commands", type: "get_commands" })}\n`);
    });
  } finally {
    child.kill("SIGTERM");
  }
}
