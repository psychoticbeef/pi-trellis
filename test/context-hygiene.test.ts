import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTEXT_READ_MAX_AGE_TURNS,
  FILE_PRUNED_STUB,
  parseContextReadMaxAgeTurns,
  pruneContextMessages,
  TRELLIS_PRUNED_STUB,
} from "../src/context-hygiene.js";

type Messages = ContextEvent["messages"];

const user = (text: string) => ({ role: "user", content: text, timestamp: 1 });
const assistantCall = (id: string, name: string, args: Record<string, unknown> = {}) => ({
  role: "assistant",
  content: [{ type: "toolCall", id, name, arguments: args }],
  api: "test",
  provider: "test",
  model: "test",
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "toolUse",
  timestamp: 2,
});
const toolResult = (id: string, name: string, text: string, extra: Record<string, unknown> = {}) => ({
  role: "toolResult",
  toolCallId: id,
  toolName: name,
  content: [{ type: "text", text }],
  details: { source: text },
  isError: false,
  timestamp: 3,
  ...extra,
});
const messages = (...items: unknown[]) => items as Messages;

const options = {
  cwd: "/project/subdir",
  projectRoot: "/project",
  readMaxAgeTurns: DEFAULT_CONTEXT_READ_MAX_AGE_TURNS,
};

describe("UT-17 Strukturerhalt und Trellis-Auswahl", () => {
  it("UT-17 erhält zuerst Struktur und Metadaten und ersetzt ausschließlich content", () => {
    const oldResult = toolResult("old", "trellis_get_tree", "old tree", {
      usage: {
        input: 8,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 10,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      customMetadata: { keep: true },
    });
    const input = messages(
      user("first"),
      assistantCall("old", "trellis_get_tree", { story_id: "US-1" }),
      oldResult,
      user("second"),
      assistantCall("new", "trellis_get_tree", { story_id: "US-2" }),
      toolResult("new", "trellis_get_tree", "new tree"),
      user("current"),
    );

    const result = pruneContextMessages(input, options);

    expect(result).toHaveLength(input.length);
    expect(result.map((message) => message.role)).toEqual(input.map((message) => message.role));
    const { content: oldContent, ...oldMetadata } = oldResult;
    const { content: resultContent, ...resultMetadata } = result[2] as typeof oldResult;
    expect(oldContent).not.toEqual(resultContent);
    expect(resultContent).toEqual([{ type: "text", text: TRELLIS_PRUNED_STUB }]);
    expect(resultMetadata).toEqual(oldMetadata);
    expect(result[0]).toBe(input[0]);
    expect(result[1]).toBe(input[1]);
    expect(result[5]).toBe(input[5]);
    expect(result[6]).toBe(input[6]);
  });

  it("UT-17 behandelt Trellis-Tools getrennt und erhält das jeweils jüngste Result", () => {
    const input = messages(
      user("old"),
      assistantCall("tree-1", "trellis_get_tree"),
      toolResult("tree-1", "trellis_get_tree", "tree 1"),
      assistantCall("overview-1", "trellis_get_overview"),
      toolResult("overview-1", "trellis_get_overview", "overview 1"),
      user("later"),
      assistantCall("tree-2", "trellis_get_tree"),
      toolResult("tree-2", "trellis_get_tree", "tree 2"),
      user("current"),
    );

    const result = pruneContextMessages(input, options);

    expect(toolContent(result, 2)).toEqual([{ type: "text", text: TRELLIS_PRUNED_STUB }]);
    expect(result[4]).toBe(input[4]);
    expect(result[7]).toBe(input[7]);
  });

  it("UT-17 erhält verwaiste oder widersprüchlich zugeordnete Trellis-Results", () => {
    const input = messages(
      user("old"),
      toolResult("orphan", "trellis_get_tree", "orphan"),
      assistantCall("mismatch", "read", { path: "/tmp/tree" }),
      toolResult("mismatch", "trellis_get_tree", "mismatch"),
      user("later"),
      assistantCall("valid", "trellis_get_tree"),
      toolResult("valid", "trellis_get_tree", "valid"),
      user("current"),
    );

    const result = pruneContextMessages(input, options);

    expect(result[1]).toBe(input[1]);
    expect(result[3]).toBe(input[3]);
  });

  it("UT-17 erhält Kontexte ohne User-Message unverändert", () => {
    const input = messages(
      assistantCall("tree", "trellis_get_tree"),
      toolResult("tree", "trellis_get_tree", "tree"),
    );

    expect(pruneContextMessages(input, options)).toBe(input);
  });

  it("UT-17 erkennt MCP-Gateway-Aufrufe und erhält sämtliche Results des aktuellen Turns", () => {
    const input = messages(
      user("old"),
      assistantCall("gateway-old", "mcp", { tool: "trellis_get_node", args: { node_id: "DD-1" } }),
      toolResult("gateway-old", "mcp", "old node"),
      user("current"),
      assistantCall("gateway-current-1", "mcp", { tool: "trellis_get_node", args: { node_id: "DD-2" } }),
      toolResult("gateway-current-1", "mcp", "current node 1"),
      assistantCall("gateway-current-2", "mcp", { server: "trellis", tool: "get_node", args: { node_id: "DD-3" } }),
      toolResult("gateway-current-2", "mcp", "current node 2"),
    );

    const result = pruneContextMessages(input, options);

    expect(toolContent(result, 2)).toEqual([{ type: "text", text: TRELLIS_PRUNED_STUB }]);
    expect(result[5]).toBe(input[5]);
    expect(result[7]).toBe(input[7]);
  });
});

describe("UT-18 read-Pfadgrenzen, Turn-Alter und Aufbewahrungsfenster", () => {
  it("UT-18 bereinigt erst bei Alter größer N und nur außerhalb des Projekts", () => {
    const atBoundary = readHistory("/opt/pi/docs/extensions.md", 3);
    const absoluteExternal = readHistory("/opt/pi/docs/extensions.md", 4);
    const relativeExternal = readHistory("../../../opt/pi/docs/extensions.md", 4);
    const relativeInternal = readHistory("../src/index.ts", 4);
    const absoluteInternal = readHistory("/project/src/index.ts", 4);

    expect(pruneContextMessages(atBoundary, options)[2]).toBe(atBoundary[2]);
    for (const external of [absoluteExternal, relativeExternal]) {
      expect(toolContent(pruneContextMessages(external, options), 2)).toEqual([
        { type: "text", text: FILE_PRUNED_STUB },
      ]);
    }
    expect(pruneContextMessages(relativeInternal, options)[2]).toBe(relativeInternal[2]);
    expect(pruneContextMessages(absoluteInternal, options)[2]).toBe(absoluteInternal[2]);
  });

  it("UT-18 erkennt Präfixkollisionen als extern und erhält read-Results des aktuellen Turns", () => {
    const prefixCollision = readHistory("/project-other/docs/extensions.md", 4);
    const current = messages(
      user("current"),
      assistantCall("read-current", "read", { path: "/opt/pi/docs/extensions.md" }),
      toolResult("read-current", "read", "current docs"),
    );

    expect(toolContent(pruneContextMessages(prefixCollision, options), 2)).toEqual([
      { type: "text", text: FILE_PRUNED_STUB },
    ]);
    expect(pruneContextMessages(current, { ...options, readMaxAgeTurns: 0 })[2]).toBe(current[2]);
  });

  it("UT-18 parst Standard, Override 0 und ungültige Konfiguration", () => {
    expect(parseContextReadMaxAgeTurns(undefined)).toBe(3);
    expect(parseContextReadMaxAgeTurns("0")).toBe(0);
    expect(parseContextReadMaxAgeTurns("12")).toBe(12);
    for (const invalid of ["", "-1", "1.5", "abc", "9007199254740992"]) {
      expect(parseContextReadMaxAgeTurns(invalid)).toBe(3);
    }
  });
});

function toolContent(items: Messages, index: number) {
  const message = items[index];
  if (message.role !== "toolResult") throw new Error(`message ${index} is not a tool result`);
  return message.content;
}

function readHistory(path: string, age: number): Messages {
  const result: unknown[] = [
    user("origin"),
    assistantCall("read-old", "read", { path }),
    toolResult("read-old", "read", "large docs"),
  ];
  for (let turn = 1; turn <= age; turn += 1) result.push(user(`turn-${turn}`));
  return messages(...result);
}
