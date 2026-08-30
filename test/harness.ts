import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type CommandHandler = (args: string, context: CommandContext) => Promise<void>;
export type BeforeAgentStartHandler = (
  event: { systemPrompt: string },
  context: HookContext,
) => Promise<{ systemPrompt: string } | undefined>;
export type TurnEndHandler = (
  event: { turnIndex: number },
  context: HookContext,
) => Promise<void>;

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
  const messages: Array<{ content: string; display?: boolean }> = [];
  const userMessages: unknown[] = [];
  const notifications: Array<{ message: string; level: string }> = [];
  const statuses: Array<{ key: string; value: string | undefined }> = [];
  let beforeAgentStart: BeforeAgentStartHandler | undefined;
  let turnEnd: TurnEndHandler | undefined;

  const api = {
    registerCommand(name: string, options: { handler: CommandHandler }) {
      commands.set(name, options.handler);
    },
    on(event: string, handler: BeforeAgentStartHandler | TurnEndHandler) {
      if (event === "before_agent_start") beforeAgentStart = handler as BeforeAgentStartHandler;
      if (event === "turn_end") turnEnd = handler as TurnEndHandler;
    },
    sendMessage(message: { content: string; display?: boolean }) {
      messages.push(message);
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
    beforeAgentStart: () => {
      if (!beforeAgentStart) throw new Error("before_agent_start not registered");
      return beforeAgentStart;
    },
    turnEnd: () => {
      if (!turnEnd) throw new Error("turn_end not registered");
      return turnEnd;
    },
  };
}
