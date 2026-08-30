import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { TrellisOverview } from "./context.js";

const PROTOCOL_VERSION = "2025-03-26";

export type SpawnTrellis = (
  command: string,
  args: string[],
) => ChildProcessWithoutNullStreams;

export interface TrellisMcpClientOptions {
  spawnProcess?: SpawnTrellis;
  timeoutMs?: number;
}

export interface StoryForPath {
  id: string;
  title: string;
  status: string;
}

export interface SpecsForPathResult {
  stories: StoryForPath[];
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export class TrellisMcpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrellisMcpError";
  }
}

export class TrellisMcpClient {
  private readonly spawnProcess: SpawnTrellis;
  private readonly timeoutMs: number;

  constructor(options: TrellisMcpClientOptions = {}) {
    this.spawnProcess = options.spawnProcess ?? ((command, args) => spawn(command, args, { stdio: "pipe" }));
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async getOverview(projectId: string, signal?: AbortSignal): Promise<TrellisOverview> {
    return parseOverview(await this.callTool(projectId, "get_overview", {}, signal));
  }

  async specsForPath(
    projectId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<SpecsForPathResult> {
    return parseSpecsForPath(await this.callTool(projectId, "specs_for_path", { path }, signal));
  }

  private async callTool(
    projectId: string,
    toolName: string,
    toolArguments: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const args = ["serve", "--project", projectId, "--board-addr", "off"];
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnProcess("trellis", args);
    } catch (error) {
      throw new TrellisMcpError(`Trellis-MCP-Server konnte nicht gestartet werden: ${messageOf(error)}`);
    }

    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    const stderr: string[] = [];
    let nextId = 1;
    let startupError: Error | undefined;
    const lines = createInterface({ input: child.stdout });

    const rejectPending = (error: Error) => {
      for (const request of pending.values()) request.reject(error);
      pending.clear();
    };

    lines.on("line", (line) => {
      let response: JsonRpcResponse;
      try {
        response = JSON.parse(line) as JsonRpcResponse;
      } catch {
        rejectPending(new TrellisMcpError(`Ungültige JSON-RPC-Antwort: ${clip(line, 160)}`));
        return;
      }
      if (typeof response.id !== "number") return;
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      if (response.error) {
        request.reject(new TrellisMcpError(`MCP ${response.error.code ?? "Fehler"}: ${response.error.message ?? "Unbekannter Toolfehler"}`));
      } else {
        request.resolve(response.result);
      }
    });
    child.stderr.on("data", (chunk: Buffer | string) => stderr.push(String(chunk)));
    child.stdin.on("error", (error) => {
      rejectPending(new TrellisMcpError(`Trellis-MCP-stdin fehlgeschlagen: ${messageOf(error)}`));
    });
    child.once("error", (error) => {
      startupError = new TrellisMcpError(`Trellis-MCP-Server konnte nicht gestartet werden: ${messageOf(error)}`);
      rejectPending(startupError);
    });
    child.once("exit", (code, processSignal) => {
      if (pending.size === 0) return;
      const detail = stderr.join("").trim();
      rejectPending(new TrellisMcpError(
        `Trellis-MCP-Server wurde vorzeitig beendet (${processSignal ?? code ?? "unbekannt"})${detail ? `: ${clip(detail, 240)}` : ""}`,
      ));
    });

    const request = (method: string, params: unknown): Promise<unknown> => {
      if (startupError) return Promise.reject(startupError);
      const id = nextId++;
      const promise = new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }));
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return promise;
    };

    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const abortPromise = new Promise<never>((_, reject) => {
      const abort = () => {
        const reason = signal?.aborted ? "abgebrochen" : `Timeout nach ${this.timeoutMs} ms`;
        const error = new TrellisMcpError(`Trellis-MCP-Anfrage ${reason}`);
        rejectPending(error);
        reject(error);
      };
      if (combinedSignal.aborted) abort();
      else combinedSignal.addEventListener("abort", abort, { once: true });
    });

    try {
      const initialize = request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "pi-trellis", version: "0.1.0" },
      });
      await Promise.race([initialize, abortPromise]);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
      const raw = await Promise.race([
        request("tools/call", { name: toolName, arguments: toolArguments }),
        abortPromise,
      ]);
      return raw;
    } finally {
      lines.close();
      rejectPending(new TrellisMcpError("Trellis-MCP-Verbindung geschlossen"));
      await stopChild(child);
    }
  }
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.stdin.end();
  child.kill("SIGTERM");
  await Promise.race([exited, delay(250)]);
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL");
  await Promise.race([exited, delay(250)]);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseOverview(raw: unknown): TrellisOverview {
  if (typeof raw !== "object" || raw === null) {
    throw new TrellisMcpError("get_overview lieferte kein Ergebnisobjekt");
  }
  const result = raw as Record<string, unknown>;
  if (typeof result.structuredContent === "object" && result.structuredContent !== null) {
    return result.structuredContent as TrellisOverview;
  }
  if (Array.isArray(result.content)) {
    const text = result.content.find((item) =>
      typeof item === "object" && item !== null && (item as Record<string, unknown>).type === "text",
    ) as Record<string, unknown> | undefined;
    if (typeof text?.text === "string") {
      try {
        return JSON.parse(text.text) as TrellisOverview;
      } catch (error) {
        throw new TrellisMcpError(`get_overview enthielt ungültiges JSON: ${messageOf(error)}`);
      }
    }
  }
  throw new TrellisMcpError("get_overview enthielt weder structuredContent noch Textinhalt");
}

function parseSpecsForPath(raw: unknown): SpecsForPathResult {
  const value = parseStructuredOrText(raw, "specs_for_path");
  if (typeof value !== "object" || value === null || !Array.isArray((value as Record<string, unknown>).stories)) {
    throw new TrellisMcpError("specs_for_path lieferte keine Story-Liste");
  }
  const stories = (value as { stories: unknown[] }).stories.map((story, index) => {
    if (typeof story !== "object" || story === null) {
      throw new TrellisMcpError(`specs_for_path Story ${index + 1} ist ungültig`);
    }
    const candidate = story as Record<string, unknown>;
    if (typeof candidate.id !== "string" || typeof candidate.title !== "string" || typeof candidate.status !== "string") {
      throw new TrellisMcpError(`specs_for_path Story ${index + 1} enthält nicht id, title und status`);
    }
    return { id: candidate.id, title: candidate.title, status: candidate.status };
  });
  return { stories };
}

function parseStructuredOrText(raw: unknown, toolName: string): unknown {
  if (typeof raw !== "object" || raw === null) {
    throw new TrellisMcpError(`${toolName} lieferte kein Ergebnisobjekt`);
  }
  const result = raw as Record<string, unknown>;
  if (typeof result.structuredContent === "object" && result.structuredContent !== null) {
    return result.structuredContent;
  }
  if (Array.isArray(result.content)) {
    const text = result.content.find((item) =>
      typeof item === "object" && item !== null && (item as Record<string, unknown>).type === "text",
    ) as Record<string, unknown> | undefined;
    if (typeof text?.text === "string") {
      try {
        return JSON.parse(text.text) as unknown;
      } catch (error) {
        throw new TrellisMcpError(`${toolName} enthielt ungültiges JSON: ${messageOf(error)}`);
      }
    }
  }
  throw new TrellisMcpError(`${toolName} enthielt weder structuredContent noch Textinhalt`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clip(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
