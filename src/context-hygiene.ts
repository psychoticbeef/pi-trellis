import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ContextEvent } from "@earendil-works/pi-coding-agent";

export const DEFAULT_CONTEXT_READ_MAX_AGE_TURNS = 3;
export const TRELLIS_PRUNED_STUB = "[pruned: Wahrheit liegt in trellis]";
export const FILE_PRUNED_STUB = "[pruned: Datei erneut lesen falls nötig]";

type ContextMessage = ContextEvent["messages"][number];
type ContextMessages = ContextEvent["messages"];

interface ToolCallInfo {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ContextHygieneOptions {
  cwd: string;
  projectRoot: string;
  readMaxAgeTurns: number;
}

export function parseContextReadMaxAgeTurns(value: string | undefined): number {
  if (value === undefined) return DEFAULT_CONTEXT_READ_MAX_AGE_TURNS;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return DEFAULT_CONTEXT_READ_MAX_AGE_TURNS;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : DEFAULT_CONTEXT_READ_MAX_AGE_TURNS;
}

export function pruneContextMessages(
  messages: ContextMessages,
  options: ContextHygieneOptions,
): ContextMessages {
  const currentTurnStart = findCurrentTurnStart(messages);
  if (currentTurnStart < 0) return messages;

  const toolCalls = indexToolCalls(messages);
  const trellisKeys = new Map<number, string>();
  const latestTrellisResult = new Map<string, number>();

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "toolResult") continue;
    const key = trellisToolKey(message.toolName, toolCalls.get(message.toolCallId));
    if (!key) continue;
    trellisKeys.set(index, key);
    latestTrellisResult.set(key, index);
  }

  const turnOrdinals = userTurnOrdinals(messages);
  const currentTurnOrdinal = turnOrdinals[currentTurnStart];

  return messages.map((message, index) => {
    if (message.role !== "toolResult" || index >= currentTurnStart) return message;

    const trellisKey = trellisKeys.get(index);
    if (trellisKey && latestTrellisResult.get(trellisKey) !== index) {
      return replaceToolResultContent(message, TRELLIS_PRUNED_STUB);
    }

    const call = toolCalls.get(message.toolCallId);
    if (message.toolName !== "read" || call?.name !== "read") return message;
    const readPath = call.arguments.path;
    if (typeof readPath !== "string" || readPath.length === 0) return message;
    if (isProjectPath(readPath, options.cwd, options.projectRoot)) return message;

    const resultTurnOrdinal = turnOrdinals[index];
    if (resultTurnOrdinal < 0) return message;
    const age = currentTurnOrdinal - resultTurnOrdinal;
    if (age <= options.readMaxAgeTurns) return message;

    return replaceToolResultContent(message, FILE_PRUNED_STUB);
  });
}

function findCurrentTurnStart(messages: ContextMessages): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") return index;
  }
  return -1;
}

function userTurnOrdinals(messages: ContextMessages): number[] {
  let ordinal = -1;
  return messages.map((message) => {
    if (message.role === "user") ordinal += 1;
    return ordinal;
  });
}

function indexToolCalls(messages: ContextMessages): Map<string, ToolCallInfo> {
  const calls = new Map<string, ToolCallInfo>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type !== "toolCall") continue;
      calls.set(block.id, { name: block.name, arguments: block.arguments });
    }
  }
  return calls;
}

function trellisToolKey(toolName: string, call: ToolCallInfo | undefined): string | undefined {
  if (!call) return undefined;
  const direct = normalizeTrellisToolName(toolName);
  if (direct) return normalizeTrellisToolName(call.name) === direct ? direct : undefined;
  if (toolName !== "mcp" || call.name !== "mcp") return undefined;

  const calledTool = call.arguments.tool;
  const server = call.arguments.server;
  if (typeof calledTool !== "string") return undefined;
  const normalized = normalizeTrellisToolName(calledTool);
  if (normalized) return normalized;
  return server === "trellis" && calledTool.length > 0 ? calledTool : undefined;
}

function normalizeTrellisToolName(toolName: string): string | undefined {
  for (const pattern of [/^trellis[_:.](.+)$/, /^mcp__trellis__(.+)$/]) {
    const match = pattern.exec(toolName);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function isProjectPath(path: string, cwd: string, projectRoot: string): boolean {
  const absolutePath = resolve(cwd, path);
  const absoluteRoot = resolve(projectRoot);
  const fromRoot = relative(absoluteRoot, absolutePath);
  return fromRoot === "" || (!isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`));
}

function replaceToolResultContent(
  message: Extract<ContextMessage, { role: "toolResult" }>,
  text: string,
): ContextMessage {
  return { ...message, content: [{ type: "text", text }] };
}
