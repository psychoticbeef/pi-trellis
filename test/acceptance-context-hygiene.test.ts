import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { FILE_PRUNED_STUB, TRELLIS_PRUNED_STUB } from "../src/context-hygiene.js";
import { createTrellisExtension } from "../src/index.js";
import { createPiHarness } from "./harness.js";

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

describe("US-8 Context-Hygiene", () => {
  it("AT-8 erhält zuerst die vollständige Conversation-Struktur", async () => {
    const { harness, context } = await activeHarness();
    const old = toolResult("old", "trellis_get_tree", "old", { custom: { keep: true } });
    const input = messages(
      user("old turn"),
      assistantCall("old", "trellis_get_tree"),
      old,
      user("later turn"),
      assistantCall("new", "trellis_get_tree"),
      toolResult("new", "trellis_get_tree", "new"),
      user("current turn"),
    );

    const result = await harness.contextEvent()(contextEvent(input), context);

    expect(result?.messages).toHaveLength(input.length);
    const replaced = result!.messages[2];
    if (replaced.role !== "toolResult") throw new Error("invalid result role");
    const { content: _oldContent, ...oldMetadata } = old;
    const { content, ...newMetadata } = replaced;
    expect(content).toEqual([{ type: "text", text: TRELLIS_PRUNED_STUB }]);
    expect(newMetadata).toEqual(oldMetadata);
    expect(result!.messages.map((message) => message.role)).toEqual(input.map((message) => message.role));
    expect(result!.messages[5]).toBe(input[5]);
  });

  it("AT-9 lässt den Kontext ohne aktiven Trellis-Modus unverändert", async () => {
    const harness = createPiHarness();
    createTrellisExtension()(harness.api);
    const input = messages(
      user("old"),
      assistantCall("old", "trellis_get_tree"),
      toolResult("old", "trellis_get_tree", "old"),
      user("current"),
    );

    expect(harness.contextEvent()(contextEvent(input), harness.context("/project"))).toBeUndefined();
    expect(toolText(input, 2)).toBe("old");
  });

  it("AT-10 bereinigt überholte Trellis-Results pro Tool und nie im aktuellen Turn", async () => {
    const { harness, context } = await activeHarness();
    const input = messages(
      user("old"),
      assistantCall("tree-old", "trellis_get_tree"),
      toolResult("tree-old", "trellis_get_tree", "old tree"),
      assistantCall("overview", "trellis_get_overview"),
      toolResult("overview", "trellis_get_overview", "only overview"),
      user("current"),
      assistantCall("tree-current-1", "trellis_get_tree"),
      toolResult("tree-current-1", "trellis_get_tree", "current tree 1"),
      assistantCall("tree-current-2", "trellis_get_tree"),
      toolResult("tree-current-2", "trellis_get_tree", "current tree 2"),
    );

    const result = (await harness.contextEvent()(contextEvent(input), context))!.messages;

    expect(toolText(result, 2)).toBe(TRELLIS_PRUNED_STUB);
    expect(result[4]).toBe(input[4]);
    expect(result[7]).toBe(input[7]);
    expect(result[9]).toBe(input[9]);
  });

  it("AT-11 bereinigt nur externe read-Results nach dem konfigurierten Aufbewahrungsfenster", async () => {
    const defaults = await activeHarness();
    const external = readHistory("/opt/pi/docs/extensions.md", 4);
    const internal = readHistory("src/index.ts", 4);
    const atBoundary = readHistory("/opt/pi/docs/extensions.md", 3);

    const externalResult = (await defaults.harness.contextEvent()(contextEvent(external), defaults.context))!.messages;
    const internalResult = (await defaults.harness.contextEvent()(contextEvent(internal), defaults.context))!.messages;
    const boundaryResult = (await defaults.harness.contextEvent()(contextEvent(atBoundary), defaults.context))!.messages;
    expect(toolText(externalResult, 2)).toBe(FILE_PRUNED_STUB);
    expect(toolText(internalResult, 2)).toBe("docs");
    expect(toolText(boundaryResult, 2)).toBe("docs");

    const configured = await activeHarness({ TRELLIS_CONTEXT_READ_MAX_AGE_TURNS: "0" });
    const ageOne = readHistory("/opt/pi/docs/extensions.md", 1);
    const configuredResult = (await configured.harness.contextEvent()(contextEvent(ageOne), configured.context))!.messages;
    expect(toolText(configuredResult, 2)).toBe(FILE_PRUNED_STUB);
  });

  it("IT-8 integriert Aktivierung, context-Handler, Trellis- und read-Bereinigung", async () => {
    const { harness, context } = await activeHarness({ TRELLIS_CONTEXT_READ_MAX_AGE_TURNS: "0" });
    const input = messages(
      user("origin"),
      assistantCall("tree-old", "mcp", { tool: "trellis_get_tree", args: {} }),
      toolResult("tree-old", "mcp", "old tree"),
      assistantCall("read-old", "read", { path: "/opt/pi/docs/extensions.md" }),
      toolResult("read-old", "read", "docs"),
      user("completed"),
      assistantCall("tree-new", "mcp", { tool: "trellis_get_tree", args: {} }),
      toolResult("tree-new", "mcp", "new tree"),
      user("current"),
    );

    const result = (await harness.contextEvent()(contextEvent(input), context))!.messages;

    expect(toolText(result, 2)).toBe(TRELLIS_PRUNED_STUB);
    expect(toolText(result, 4)).toBe(FILE_PRUNED_STUB);
    expect(result[7]).toBe(input[7]);
    await harness.commands.get("trellis:off")!("", context);
    expect(harness.contextEvent()(contextEvent(input), context)).toBeUndefined();
  });
});

async function activeHarness(environment: NodeJS.ProcessEnv = {}) {
  const harness = createPiHarness();
  createTrellisExtension({
    environment,
    readTextFile: async () => "trellis-project: project-1\n",
    getOverview: async () => ({ description: "active" }),
    ensureAgentRecipes: async () => undefined,
  })(harness.api);
  const context = harness.context("/project");
  await harness.commands.get("trellis:on")!("", context);
  return { harness, context };
}

function contextEvent(items: Messages): ContextEvent {
  return { type: "context", messages: items };
}

function readHistory(path: string, age: number): Messages {
  const result: unknown[] = [
    user("origin"),
    assistantCall("read-old", "read", { path }),
    toolResult("read-old", "read", "docs"),
  ];
  for (let turn = 1; turn <= age; turn += 1) result.push(user(`turn-${turn}`));
  return messages(...result);
}

function toolText(items: Messages, index: number): string {
  const message = items[index];
  if (message.role !== "toolResult") throw new Error(`message ${index} is not a tool result`);
  const block = message.content[0];
  if (block?.type !== "text") throw new Error(`message ${index} has no text result`);
  return block.text;
}
