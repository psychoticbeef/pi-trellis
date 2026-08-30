import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { TrellisMcpClient, type SpawnTrellis } from "../src/mcp-client.js";

function server(resultExpression: string): string {
  return String.raw`
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const r = JSON.parse(line);
  if (r.method === 'initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{protocolVersion:'2025-03-26',capabilities:{},serverInfo:{name:'fake',version:'1'}}})+'\n');
  if (r.method === 'tools/call') {
    const result = ${resultExpression};
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\n');
  }
});`;
}

const spawnServer = (source: string): SpawnTrellis =>
  () => spawn(process.execPath, ["-e", source], { stdio: "pipe" });

describe("UT-6 specs_for_path-Protokoll und Antwortparser", () => {
  it("UT-6 sendet specs_for_path mit Pfad und parst structuredContent", async () => {
    const source = server(`({structuredContent:{stories:[{id:'US-1',title:r.params.name+':'+r.params.arguments.path,status:'done'}]}})`);
    const result = await new TrellisMcpClient({ spawnProcess: spawnServer(source), timeoutMs: 1_000 })
      .specsForPath("project-3", "src/index.ts");
    expect(result).toEqual({ stories: [
      { id: "US-1", title: "specs_for_path:src/index.ts", status: "done" },
    ] });
  });

  it("UT-6 parst JSON-Text und leere Treffer", async () => {
    const source = server(`({content:[{type:'text',text:JSON.stringify({stories:[]})}]})`);
    await expect(new TrellisMcpClient({ spawnProcess: spawnServer(source), timeoutMs: 1_000 })
      .specsForPath("project-3", "README.md")).resolves.toEqual({ stories: [] });
  });

  it("UT-6 lehnt ungültige Antworten konkret ab", async () => {
    const source = server(`({structuredContent:{stories:[{id:'US-1',status:'done'}]}})`);
    await expect(new TrellisMcpClient({ spawnProcess: spawnServer(source), timeoutMs: 1_000 })
      .specsForPath("project-3", "src/index.ts")).rejects.toThrow(/id, title und status/);
  });

  it("UT-6 unterstützt Abort und Timeout für specs_for_path", async () => {
    const hanging: SpawnTrellis = () =>
      spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "pipe" });
    const controller = new AbortController();
    controller.abort();
    await expect(new TrellisMcpClient({ spawnProcess: hanging, timeoutMs: 1_000 })
      .specsForPath("project-3", "a.ts", controller.signal)).rejects.toThrow(/abgebrochen/);
    await expect(new TrellisMcpClient({ spawnProcess: hanging, timeoutMs: 30 })
      .specsForPath("project-3", "a.ts")).rejects.toThrow(/Timeout/);
  });
});
