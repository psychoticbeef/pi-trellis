import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createTrellisExtension } from "../src/index.js";
import { TrellisMcpClient, type SpawnTrellis } from "../src/mcp-client.js";
import { createPiHarness } from "./harness.js";

const fakeServer = String.raw`
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const r = JSON.parse(line);
  if (r.method === 'initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{protocolVersion:'2025-03-26',capabilities:{},serverInfo:{name:'fake',version:'1'}}})+'\n');
  if (r.method === 'tools/call') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{structuredContent:{description:'Integration',glossary:[{term:'Trellis-Modus',definition:'aktiv'}],stories:[{id:'US-7',title:'Feature',status:'in_progress'}],stale_nodes:[]}}})+'\n');
});`;

describe("IT-1 Pi-Extension mit MCP-stdio", () => {
  it("IT-1 verbindet Commands, echten stdio-Austausch, Hook und Deaktivierung", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-trellis-it1-"));
    await writeFile(join(root, "AGENTS.md"), "trellis-project: project-7\n", "utf8");
    const calls: string[][] = [];
    const fakeSpawn: SpawnTrellis = (command, args) => {
      calls.push([command, ...args]);
      return spawn(process.execPath, ["-e", fakeServer], { stdio: "pipe" });
    };
    const client = new TrellisMcpClient({ spawnProcess: fakeSpawn, timeoutMs: 1_000 });
    const harness = createPiHarness();
    createTrellisExtension({
      environment: { TRELLIS_BOARD_ADDRESS: "http://board.test:9000" },
      getOverview: (id, signal) => client.getOverview(id, signal),
    })(harness.api);

    await harness.commands.get("trellis:on")!("", harness.context(root));
    expect(harness.messages.at(-1)?.content).toBe("Trellis-Modus aktiviert: http://board.test:9000/p/project-7/");

    const injected = await harness.beforeAgentStart()({ systemPrompt: "base" }, harness.context(root));
    expect(injected?.systemPrompt).toContain("Description: Integration");
    expect(injected?.systemPrompt).toContain(`worktree=${join(root, ".trellis-worktrees", "US-7")}`);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(["trellis", "serve", "--project", "project-7", "--board-addr", "off"]);

    await harness.commands.get("trellis:off")!("", harness.context(root));
    expect(harness.messages.at(-1)?.content).toBe("Trellis-Modus deaktiviert.");
    await expect(harness.beforeAgentStart()({ systemPrompt: "base" }, harness.context(root))).resolves.toBeUndefined();
    expect(calls).toHaveLength(2);
  });
});
