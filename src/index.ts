import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildBoardUrl, findTrellisProject, type ReadTextFile, type TrellisProject } from "./config.js";
import { addWorktreePaths, formatTrellisContext, type TrellisOverview } from "./context.js";
import { TrellisMcpClient } from "./mcp-client.js";

export interface ExtensionDependencies {
  readTextFile?: ReadTextFile;
  environment?: NodeJS.ProcessEnv;
  getOverview?: (projectId: string, signal?: AbortSignal) => Promise<TrellisOverview>;
}

interface ActiveState {
  project: TrellisProject;
  boardAddress?: string;
  lastOverview: TrellisOverview;
}

export function createTrellisExtension(dependencies: ExtensionDependencies = {}) {
  const environment = dependencies.environment ?? process.env;
  const getOverview = dependencies.getOverview ?? ((projectId, signal) =>
    new TrellisMcpClient().getOverview(projectId, signal));

  return function trellisExtension(pi: ExtensionAPI): void {
    let active: ActiveState | undefined;

    const emit = (content: string): void => {
      pi.sendMessage({ customType: "trellis", content, display: true });
    };

    pi.registerCommand("trellis:on", {
      description: "Trellis-Modus aktivieren",
      handler: async (_args, ctx) => {
        active = undefined;
        try {
          const project = await findTrellisProject(ctx.cwd, dependencies.readTextFile);
          const boardAddress = environment.TRELLIS_BOARD_ADDRESS;
          const boardUrl = buildBoardUrl(project.id, boardAddress);
          const overview = addWorktreePaths(await getOverview(project.id), project.root);
          active = { project, boardAddress, lastOverview: overview };
          emit(`Trellis-Modus aktiviert: ${boardUrl}`);
        } catch (error) {
          emit(`Trellis-Modus nicht aktiviert: ${messageOf(error)}`);
        }
      },
    });

    pi.registerCommand("trellis:off", {
      description: "Trellis-Modus deaktivieren",
      handler: async () => {
        active = undefined;
        emit("Trellis-Modus deaktiviert.");
      },
    });

    pi.on("before_agent_start", async (event, ctx) => {
      const state = active;
      if (!state) return undefined;
      let overview: TrellisOverview;
      try {
        overview = addWorktreePaths(
          await getOverview(state.project.id, ctx.signal),
          state.project.root,
        );
      } catch (error) {
        if (active !== state) return undefined;
        const reason = messageOf(error);
        ctx.ui.notify(`Trellis-Aktualisierung fehlgeschlagen: ${reason}`, "warning");
        overview = {
          description: `unavailable: ${reason}`,
          glossary: [],
          stories: [],
          stale_nodes: ["unavailable"],
        };
      }
      if (active !== state) return undefined;
      state.lastOverview = overview;
      const contextBlock = formatTrellisContext(overview);
      return { systemPrompt: `${event.systemPrompt}\n\n${contextBlock}` };
    });
  };
}

export default createTrellisExtension();

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
