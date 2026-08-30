import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type CommandHandler = (args: string, context: CommandContext) => Promise<void>;
export type BeforeAgentStartHandler = (
  event: { systemPrompt: string },
  context: HookContext,
) => Promise<{ systemPrompt: string } | undefined>;

export interface CommandContext {
  cwd: string;
  ui: { notify: (message: string, level: string) => void };
}

export interface HookContext extends CommandContext {
  signal?: AbortSignal;
}

export function createPiHarness() {
  const commands = new Map<string, CommandHandler>();
  const messages: Array<{ content: string; display?: boolean }> = [];
  let beforeAgentStart: BeforeAgentStartHandler | undefined;

  const api = {
    registerCommand(name: string, options: { handler: CommandHandler }) {
      commands.set(name, options.handler);
    },
    on(event: string, handler: BeforeAgentStartHandler) {
      if (event === "before_agent_start") beforeAgentStart = handler;
    },
    sendMessage(message: { content: string; display?: boolean }) {
      messages.push(message);
    },
  } as unknown as ExtensionAPI;

  const context = (cwd: string): HookContext => ({
    cwd,
    ui: { notify: () => undefined },
  });

  return {
    api,
    commands,
    messages,
    context,
    beforeAgentStart: () => {
      if (!beforeAgentStart) throw new Error("before_agent_start not registered");
      return beforeAgentStart;
    },
  };
}
