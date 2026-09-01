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
export type AgentSettledHandler = (
  event: Record<string, never>,
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
  model?: { contextWindow: number };
  getContextUsage: () => { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
  compact: (options?: CompactOptions) => void;
}

export interface CompactOptions {
  customInstructions?: string;
  onComplete?: (result: unknown) => void;
  onError?: (error: Error) => void;
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
  let agentSettled: AgentSettledHandler | undefined;
  let toolCall: ToolCallHandler | undefined;
  let toolResult: ToolResultHandler | undefined;
  let contextUsage: { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
  let modelContextWindow = 1_000;
  const compactCalls: CompactOptions[] = [];

  const api = {
    registerCommand(name: string, options: { handler: CommandHandler }) {
      commands.set(name, options.handler);
    },
    on(
      event: string,
      handler: SessionStartHandler | BeforeAgentStartHandler | ContextHandler | TurnEndHandler | AgentSettledHandler | ToolCallHandler | ToolResultHandler,
    ) {
      if (event === "session_start") sessionStart = handler as SessionStartHandler;
      if (event === "before_agent_start") beforeAgentStart = handler as BeforeAgentStartHandler;
      if (event === "context") contextEvent = handler as ContextHandler;
      if (event === "turn_end") turnEnd = handler as TurnEndHandler;
      if (event === "agent_settled") agentSettled = handler as AgentSettledHandler;
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
    model: {
      get contextWindow() {
        return modelContextWindow;
      },
    },
    getContextUsage: () => contextUsage,
    compact: (options = {}) => compactCalls.push(options),
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
    compactCalls,
    context,
    setContextUsage: (usage: typeof contextUsage) => {
      contextUsage = usage;
    },
    setModelContextWindow: (value: number) => {
      modelContextWindow = value;
    },
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
    agentSettled: () => {
      if (!agentSettled) throw new Error("agent_settled not registered");
      return agentSettled;
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
