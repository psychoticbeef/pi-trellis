import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  if (r.method === 'tools/call' && r.params.name === 'get_overview') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{structuredContent:{stories:[],stale_nodes:[]}}})+'\n');
  if (r.method === 'tools/call' && r.params.name === 'specs_for_path') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{structuredContent:{stories:[{id:'US-1',title:r.params.arguments.path,status:'done'}]}}})+'\n');
});`;

describe("IT-3 edit/write-Hooks mit specs_for_path über MCP-stdio", () => {
  it("IT-3 verbindet Dateiänderung, MCP-Aufruf, nextTurn-Dateihinweis und Deaktivierung", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-trellis-it3-"));
    const sourceDirectory = join(root, "src");
    const sourcePath = join(sourceDirectory, "feature.ts");
    await mkdir(sourceDirectory);
    await writeFile(join(root, "AGENTS.md"), "trellis-project: project-3\n", "utf8");
    await writeFile(sourcePath, "before", "utf8");
    let spawnCalls = 0;
    const fakeSpawn: SpawnTrellis = () => {
      spawnCalls += 1;
      return spawn(process.execPath, ["-e", fakeServer], { stdio: "pipe" });
    };
    const client = new TrellisMcpClient({ spawnProcess: fakeSpawn, timeoutMs: 1_000 });
    const harness = createPiHarness();
    createTrellisExtension({
      getOverview: (id, signal) => client.getOverview(id, signal),
      specsForPath: (id, path, signal) => client.specsForPath(id, path, signal),
    })(harness.api);
    const context = harness.context(root);

    await harness.commands.get("trellis:on")!("", context);
    await harness.toolCall()({ toolCallId: "edit-it3", toolName: "edit", input: { path: "src/feature.ts" } }, context);
    await writeFile(sourcePath, "after", "utf8");
    await harness.toolResult()({ toolCallId: "edit-it3", toolName: "edit", input: { path: "src/feature.ts" }, isError: false }, context);

    const hint = harness.messages.find((message) => message.customType === "trellis-file-hint");
    expect(hint).toMatchObject({
      content: "Datei src/feature.ts betrifft Story US-1 (src/feature.ts) – sind deren Specs/Tests noch aktuell?",
      options: { deliverAs: "nextTurn" },
    });
    expect(hint?.options?.triggerTurn).toBeUndefined();
    expect(spawnCalls).toBe(2);

    await harness.commands.get("trellis:off")!("", context);
    await harness.toolCall()({ toolCallId: "write-it3", toolName: "write", input: { path: "src/feature.ts" } }, context);
    await writeFile(sourcePath, "again", "utf8");
    await harness.toolResult()({ toolCallId: "write-it3", toolName: "write", input: { path: "src/feature.ts" }, isError: false }, context);
    expect(spawnCalls).toBe(2);
  });
});
