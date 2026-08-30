import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildBoardUrl, findTrellisProject, normalizeBoardAddress } from "../src/config.js";
import { TrellisMcpClient, type SpawnTrellis } from "../src/mcp-client.js";

const successServer = String.raw`
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{protocolVersion:'2025-03-26',capabilities:{},serverInfo:{name:'fake',version:'1'}}})+'\n');
  }
  if (request.method === 'tools/call') {
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{structuredContent:{description:'ok',glossary:[],stories:[],stale_nodes:[]}}})+'\n');
  }
});`;

describe("UT-1 Config, URL und MCP-Client", () => {
  it("UT-1 findet trellis-project aufwärts und baut Default- sowie Override-URLs", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-trellis-ut1-"));
    const nested = join(root, "a", "b");
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, "AGENTS.md"), "# Agent\ntrellis-project: project-42\n", "utf8");

    await expect(findTrellisProject(nested)).resolves.toMatchObject({ id: "project-42", root });
    expect(buildBoardUrl("project-42")).toBe("http://127.0.0.1:7420/p/project-42/");
    expect(buildBoardUrl("project-42", "https://board.example/base")).toBe("https://board.example/base/p/project-42/");
    expect(() => normalizeBoardAddress("file:///tmp/board")).toThrow(/Protokoll/);
  });

  it("UT-1 lehnt fehlende und mehrdeutige Projektangaben konkret ab", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-trellis-ut1-"));
    await expect(findTrellisProject(root)).rejects.toThrow(/Keine gültige trellis-project-Angabe/);
    await writeFile(join(root, "AGENTS.md"), "trellis-project: one\ntrellis-project: two\n", "utf8");
    await expect(findTrellisProject(root)).rejects.toThrow(/Mehrere trellis-project-Angaben/);
  });

  it("UT-1 sendet die exakte MCP-JSON-RPC-Sequenz mit den geforderten Spawn-Argumenten", async () => {
    let observed: { command: string; args: string[] } | undefined;
    const fakeSpawn: SpawnTrellis = (command, args) => {
      observed = { command, args };
      return spawn(process.execPath, ["-e", successServer], { stdio: "pipe" });
    };
    const overview = await new TrellisMcpClient({ spawnProcess: fakeSpawn, timeoutMs: 1_000 })
      .getOverview("project-42");

    expect(observed).toEqual({
      command: "trellis",
      args: ["serve", "--project", "project-42", "--board-addr", "off"],
    });
    expect(overview.description).toBe("ok");
  });

  it("UT-1 meldet einen nicht startbaren MCP-Prozess konkret", async () => {
    const brokenSpawn: SpawnTrellis = () =>
      spawn("pi-trellis-command-that-does-not-exist", [], { stdio: "pipe" });
    await expect(new TrellisMcpClient({ spawnProcess: brokenSpawn, timeoutMs: 500 }).getOverview("p"))
      .rejects.toThrow(/konnte nicht gestartet werden|stdin fehlgeschlagen/);
  });

  it("UT-1 beendet eine bereits abgebrochene MCP-Anfrage sofort", async () => {
    const hangingSpawn: SpawnTrellis = () =>
      spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "pipe" });
    const controller = new AbortController();
    controller.abort();
    await expect(new TrellisMcpClient({ spawnProcess: hangingSpawn, timeoutMs: 2_000 }).getOverview("p", controller.signal))
      .rejects.toThrow(/abgebrochen/);
  });

  it("UT-1 beendet eine hängende MCP-Anfrage per Timeout", async () => {
    const hangingSpawn: SpawnTrellis = () =>
      spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "pipe" });
    await expect(new TrellisMcpClient({ spawnProcess: hangingSpawn, timeoutMs: 30 }).getOverview("p"))
      .rejects.toThrow(/Timeout/);
  });
});
