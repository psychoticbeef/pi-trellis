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
  if (r.method === 'tools/call') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{structuredContent:{stories:[{id:'US-2',title:'Status',status:'in_progress',gates_open:false}],stale_nodes:[{id:'DD-3',title:'stale'}]}}})+'\n');
});`;

describe("IT-2 Commands, MCP-stdio, Turn-Hook und Pi-UI", () => {
  it("IT-2 integriert UI-only Status, Statusline, unreachable und Off", async () => {
    let spawnCalls = 0;
    const fakeSpawn: SpawnTrellis = () => {
      spawnCalls += 1;
      if (spawnCalls === 3) return spawn(process.execPath, ["-e", "process.exit(2)"], { stdio: "pipe" });
      return spawn(process.execPath, ["-e", fakeServer], { stdio: "pipe" });
    };
    const client = new TrellisMcpClient({ spawnProcess: fakeSpawn, timeoutMs: 1_000 });
    const harness = createPiHarness();
    createTrellisExtension({
      readTextFile: async () => "trellis-project: project-2\n",
      getOverview: (id, signal) => client.getOverview(id, signal),
    })(harness.api);
    const context = harness.context("/repo");

    await harness.commands.get("trellis:status")!("", context);
    expect(harness.notifications.at(-1)?.message).toContain("blocked_gates | US-2 Status");
    expect(harness.messages).toHaveLength(0);
    expect(harness.userMessages).toHaveLength(0);

    await harness.commands.get("trellis:on")!("", context);
    expect(harness.statuses.at(-1)?.value).toBe("trellis: US-2 | gates blocked");
    await harness.turnEnd()({ turnIndex: 0 }, context);
    expect(harness.statuses.at(-1)?.value).toBe("trellis: unreachable");
    await harness.commands.get("trellis:off")!("", context);
    expect(harness.statuses.at(-1)?.value).toBeUndefined();
    await harness.turnEnd()({ turnIndex: 1 }, context);
    expect(spawnCalls).toBe(3);
  });
});
