import { readFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildBoardUrl, findTrellisProject, type ReadTextFile, type TrellisProject } from "./config.js";
import { addWorktreePaths, formatTrellisContext, type TrellisOverview } from "./context.js";
import {
  formatFileHint,
  normalizeFilePath,
  projectPath,
  selectUnhintedDoneStories,
} from "./file-hints.js";
import { TrellisMcpClient, type SpecsForPathResult } from "./mcp-client.js";
import { formatKanbanStatus, formatStatusLine } from "./status.js";

export interface ExtensionDependencies {
  readTextFile?: ReadTextFile;
  readFileSnapshot?: (path: string) => Promise<string | undefined>;
  environment?: NodeJS.ProcessEnv;
  getOverview?: (projectId: string, signal?: AbortSignal) => Promise<TrellisOverview>;
  specsForPath?: (
    projectId: string,
    path: string,
    signal?: AbortSignal,
  ) => Promise<SpecsForPathResult>;
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
  const specsForPath = dependencies.specsForPath ?? ((projectId, path, signal) =>
    new TrellisMcpClient().specsForPath(projectId, path, signal));
  const readFileSnapshot = dependencies.readFileSnapshot ?? defaultReadFileSnapshot;

  return function trellisExtension(pi: ExtensionAPI): void {
    let active: ActiveState | undefined;
    let activationGeneration = 0;
    let statusUpdateGeneration = 0;
    const pendingFileChanges = new Map<string, {
      state: ActiveState;
      absolutePath: string;
      path: string;
      before: string | undefined;
    }>();
    const hintedStoryIds = new Set<string>();

    const emit = (content: string): void => {
      pi.sendMessage({ customType: "trellis", content, display: true });
    };

    pi.registerCommand("trellis:on", {
      description: "Trellis-Modus aktivieren",
      handler: async (_args, ctx) => {
        const generation = ++activationGeneration;
        statusUpdateGeneration += 1;
        active = undefined;
        ctx.ui.setStatus("trellis", undefined);
        try {
          const project = await findTrellisProject(ctx.cwd, dependencies.readTextFile);
          const boardAddress = environment.TRELLIS_BOARD_ADDRESS;
          const boardUrl = buildBoardUrl(project.id, boardAddress);
          const overview = addWorktreePaths(await getOverview(project.id), project.root);
          if (activationGeneration !== generation) return;
          active = { project, boardAddress, lastOverview: overview };
          ctx.ui.setStatus("trellis", ctx.ui.theme.fg("dim", formatStatusLine(overview)));
          emit(`Trellis-Modus aktiviert: ${boardUrl}`);
        } catch (error) {
          if (activationGeneration !== generation) return;
          emit(`Trellis-Modus nicht aktiviert: ${messageOf(error)}`);
        }
      },
    });

    pi.registerCommand("trellis:off", {
      description: "Trellis-Modus deaktivieren",
      handler: async (_args, ctx) => {
        activationGeneration += 1;
        statusUpdateGeneration += 1;
        active = undefined;
        ctx.ui.setStatus("trellis", undefined);
        emit("Trellis-Modus deaktiviert.");
      },
    });

    pi.registerCommand("trellis:status", {
      description: "Trellis-Kanban als reine UI-Ausgabe anzeigen",
      handler: async (_args, ctx) => {
        try {
          const project = await findTrellisProject(ctx.cwd, dependencies.readTextFile);
          const overview = addWorktreePaths(await getOverview(project.id), project.root);
          ctx.ui.notify(formatKanbanStatus(overview), "info");
        } catch (error) {
          ctx.ui.notify(`Trellis-Status nicht verfügbar: ${messageOf(error)}`, "error");
        }
      },
    });

    pi.on("tool_call", async (event, ctx) => {
      if (event.toolName !== "edit" && event.toolName !== "write") return;
      const state = active;
      if (!state) return;
      const input = event.input as { path?: unknown };
      if (typeof input.path !== "string" || input.path.length === 0) return;
      const absolutePath = normalizeFilePath(input.path, ctx.cwd);
      try {
        pendingFileChanges.set(event.toolCallId, {
          state,
          absolutePath,
          path: projectPath(absolutePath, state.project.root),
          before: await readFileSnapshot(absolutePath),
        });
      } catch {
        pendingFileChanges.delete(event.toolCallId);
      }
    });

    pi.on("tool_result", async (event, ctx) => {
      if (event.toolName !== "edit" && event.toolName !== "write") return;
      const pending = pendingFileChanges.get(event.toolCallId);
      pendingFileChanges.delete(event.toolCallId);
      if (!pending || event.isError || active !== pending.state) return;

      let after: string | undefined;
      try {
        after = await readFileSnapshot(pending.absolutePath);
      } catch {
        return;
      }
      if (after === pending.before) return;

      let result: SpecsForPathResult;
      try {
        result = await specsForPath(
          pending.state.project.id,
          pending.path,
          ctx.signal,
        );
      } catch {
        return;
      }
      if (active !== pending.state) return;

      for (const story of selectUnhintedDoneStories(result.stories, hintedStoryIds)) {
        hintedStoryIds.add(story.id);
        pi.sendMessage(
          {
            customType: "trellis-file-hint",
            content: formatFileHint(pending.path, story),
            display: true,
          },
          { deliverAs: "nextTurn" },
        );
      }
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

    pi.on("turn_end", async (_event, ctx) => {
      const state = active;
      if (!state) return;
      const updateGeneration = ++statusUpdateGeneration;
      try {
        const overview = addWorktreePaths(
          await getOverview(state.project.id, ctx.signal),
          state.project.root,
        );
        if (active !== state || statusUpdateGeneration !== updateGeneration) return;
        state.lastOverview = overview;
        ctx.ui.setStatus("trellis", ctx.ui.theme.fg("dim", formatStatusLine(overview)));
      } catch {
        if (active !== state || statusUpdateGeneration !== updateGeneration) return;
        ctx.ui.setStatus("trellis", ctx.ui.theme.fg("error", "trellis: unreachable"));
      }
    });
  };
}

export default createTrellisExtension();

async function defaultReadFileSnapshot(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
