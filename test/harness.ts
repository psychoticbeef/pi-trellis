import type { ContextEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type CommandHandler = (args: string, context: CommandContext) => Promise<void>;
export type SessionStartHandler = (
  event: { reason: string },
  context: HookContext,
) => Promise<void>;
export type BeforeAgentStartHandler = (
  event: { systemPrompt: string },
  context: HookContext,
) => Promise<{ systemPrompt: string } | undefined>;
export type TurnEndHandler = (
  event: { turnIndex: number },
  context: HookContext,
) => Promise<void>;
export type ContextHandler = (
  event: ContextEvent,
  context: HookContext,
) =>
  | { messages: ContextEvent["messages"] }
  | undefined
  | Promise<{ messages: ContextEvent["messages"] } | undefined>;
export type ToolCallHandler = (
  event: { toolCallId: string; toolName: string; input: Record<string, unknown> },
  context: HookContext,
) => Promise<unknown>;
export type ToolResultHandler = (
  event: {
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
    isError: boolean;
    content?: unknown[];
    details?: unknown;
  },
  context: HookContext,
) => Promise<unknown>;

export interface CommandContext {
  cwd: string;
  ui: {
    notify: (message: string, level: string) => void;
    setStatus: (key: string, value: string | undefined) => void;
    theme: { fg: (color: string, text: string) => string };
  };
}

export interface HookContext extends CommandContext {
  signal?: AbortSignal;
}

export function createPiHarness() {
  const commands = new Map<string, CommandHandler>();
  const messages: Array<{
    customType?: string;
    content: string;
    display?: boolean;
    options?: { deliverAs?: string; triggerTurn?: boolean };
  }> = [];
  const userMessages: unknown[] = [];
  const notifications: Array<{ message: string; level: string }> = [];
  const statuses: Array<{ key: string; value: string | undefined }> = [];
  let sessionStart: SessionStartHandler | undefined;
  let beforeAgentStart: BeforeAgentStartHandler | undefined;
  let contextEvent: ContextHandler | undefined;
  let turnEnd: TurnEndHandler | undefined;
  let toolCall: ToolCallHandler | undefined;
  let toolResult: ToolResultHandler | undefined;

  const api = {
    registerCommand(name: string, options: { handler: CommandHandler }) {
      commands.set(name, options.handler);
    },
    on(
      event: string,
      handler: SessionStartHandler | BeforeAgentStartHandler | ContextHandler | TurnEndHandler | ToolCallHandler | ToolResultHandler,
    ) {
      if (event === "session_start") sessionStart = handler as SessionStartHandler;
      if (event === "before_agent_start") beforeAgentStart = handler as BeforeAgentStartHandler;
      if (event === "context") contextEvent = handler as ContextHandler;
      if (event === "turn_end") turnEnd = handler as TurnEndHandler;
      if (event === "tool_call") toolCall = handler as ToolCallHandler;
      if (event === "tool_result") toolResult = handler as ToolResultHandler;
    },
    sendMessage(
      message: { customType?: string; content: string; display?: boolean },
      options?: { deliverAs?: string; triggerTurn?: boolean },
    ) {
      messages.push({ ...message, options });
    },
    sendUserMessage(message: unknown) {
      userMessages.push(message);
    },
  } as unknown as ExtensionAPI;

  const context = (cwd: string): HookContext => ({
    cwd,
    ui: {
      notify: (message, level) => notifications.push({ message, level }),
      setStatus: (key, value) => statuses.push({ key, value }),
      theme: { fg: (_color, text) => text },
    },
  });

  return {
    api,
    commands,
    messages,
    userMessages,
    notifications,
    statuses,
    context,
    sessionStart: () => {
      if (!sessionStart) throw new Error("session_start not registered");
      return sessionStart;
    },
    beforeAgentStart: () => {
      if (!beforeAgentStart) throw new Error("before_agent_start not registered");
      return beforeAgentStart;
    },
    contextEvent: () => {
      if (!contextEvent) throw new Error("context not registered");
      return contextEvent;
    },
    turnEnd: () => {
      if (!turnEnd) throw new Error("turn_end not registered");
      return turnEnd;
    },
    toolCall: () => {
      if (!toolCall) throw new Error("tool_call not registered");
      return toolCall;
    },
    toolResult: () => {
      if (!toolResult) throw new Error("tool_result not registered");
      return toolResult;
    },
  };
}
