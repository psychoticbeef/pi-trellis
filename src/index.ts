import { readFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ensureAgentRecipes } from "./agent-recipes.js";
import {
  AutoMode,
  buildAutoModePrompt,
  parseAutoModeAction,
  selectFirstNextStory,
  shouldCompactContext,
} from "./auto-mode.js";
import { CHECK_PROMPT } from "./check-prompt.js";
import { buildBoardUrl, findTrellisProject, type ReadTextFile, type TrellisProject } from "./config.js";
import { addWorktreePaths, formatTrellisContext, type TrellisOverview } from "./context.js";
import { parseContextReadMaxAgeTurns, pruneContextMessages } from "./context-hygiene.js";
import {
  formatFileHint,
  normalizeFilePath,
  projectPath,
  selectUnhintedDoneStories,
} from "./file-hints.js";
import { INTERVIEW_PROMPT } from "./init-prompt.js";
import { ONBOARDING_INTERVIEW_PROMPT } from "./onboarding-prompt.js";
import {
  TrellisMcpClient,
  type NextStoryResult,
  type SpecsForPathResult,
} from "./mcp-client.js";
import { buildReviewPrompt } from "./review-prompt.js";
import {
  finishStoryIdFromToolCall,
  reviewerFromAgentToolCall,
  ReviewGate,
  type Reviewer,
} from "./review-gate.js";
import { formatKanbanStatus, formatStatusLine } from "./status.js";
import {
  selectInProgressStory,
  StoryUsageTracker,
  UsageDeltaReporter,
} from "./token-usage.js";

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
  nextStory?: (projectId: string, signal?: AbortSignal) => Promise<NextStoryResult>;
  ensureAgentRecipes?: (cwd: string) => Promise<void>;
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
  const nextStory = dependencies.nextStory ?? ((projectId, signal) =>
    new TrellisMcpClient().nextStory(projectId, signal));
  const readFileSnapshot = dependencies.readFileSnapshot ?? defaultReadFileSnapshot;
  const provisionAgentRecipes = dependencies.ensureAgentRecipes ?? ensureAgentRecipes;
  const contextReadMaxAgeTurns = parseContextReadMaxAgeTurns(
    environment.TRELLIS_CONTEXT_READ_MAX_AGE_TURNS,
  );

  return function trellisExtension(pi: ExtensionAPI): void {
    let active: ActiveState | undefined;
    let activationGeneration = 0;
    let statusUpdateGeneration = 0;
    let disabledForSession = false;
    const pendingFileChanges = new Map<string, {
      state: ActiveState;
      absolutePath: string;
      path: string;
      before: string | undefined;
    }>();
    const hintedStoryIds = new Set<string>();
    const reviewGate = new ReviewGate();
    const autoMode = new AutoMode();
    const pendingReviews = new Map<string, { storyId: string; reviewer: Reviewer }>();
    let notifyUsageWarning: ((message: string) => void) | undefined;
    const usageTracker = new StoryUsageTracker(
      (message) => notifyUsageWarning?.(message),
    );
    const usageReporter = new UsageDeltaReporter(
      async (command, args) => pi.exec(command, args, { timeout: 5_000 }),
      (message) => notifyUsageWarning?.(message),
    );
    const stopCompletedUsage = pi.events.on("subagents:completed", (record) => {
      usageTracker.recordSubagent(record);
    });
    const stopFailedUsage = pi.events.on("subagents:failed", (record) => {
      usageTracker.recordSubagent(record);
    });

    const emit = (content: string): void => {
      pi.sendMessage({ customType: "trellis", content, display: true });
    };

    const activate = async (
      ctx: ExtensionContext,
      discoveredProject?: TrellisProject,
    ): Promise<void> => {
      if (disabledForSession) {
        emit("Trellis-Modus bleibt bis zum Sitzungsende deaktiviert.");
        return;
      }

      const generation = ++activationGeneration;
      statusUpdateGeneration += 1;
      active = undefined;
      ctx.ui.setStatus("trellis", undefined);
      try {
        const project = discoveredProject ??
          await findTrellisProject(ctx.cwd, dependencies.readTextFile);
        const boardAddress = environment.TRELLIS_BOARD_ADDRESS;
        const boardUrl = buildBoardUrl(project.id, boardAddress);
        const overview = addWorktreePaths(await getOverview(project.id), project.root);
        let recipeError: unknown;
        try {
          await provisionAgentRecipes(ctx.cwd);
        } catch (error) {
          recipeError = error;
        }
        if (activationGeneration !== generation || disabledForSession) return;
        active = { project, boardAddress, lastOverview: overview };
        ctx.ui.setStatus("trellis", ctx.ui.theme.fg("dim", formatStatusLine(overview)));
        if (recipeError) {
          emit(`Subagent-Rezepte nicht vollständig bereitgestellt: ${messageOf(recipeError)}`);
        }
        emit(`Trellis-Modus aktiviert: ${boardUrl}`);
      } catch (error) {
        if (activationGeneration !== generation || disabledForSession) return;
        emit(`Trellis-Modus nicht aktiviert: ${messageOf(error)}`);
      }
    };

    const requestNextStory = async (
      state: ActiveState,
      generation: number,
      ctx: ExtensionContext,
    ): Promise<void> => {
      try {
        const result = await nextStory(state.project.id, ctx.signal);
        if (active !== state || !autoMode.isQueryCurrent(generation)) return;
        const story = selectFirstNextStory(result);
        if (!story) {
          if (autoMode.finishWithoutStory(generation)) {
            ctx.ui.notify("Auto-Modus beendet: keine startbaren Stories mehr vorhanden.", "info");
          }
          return;
        }
        if (!autoMode.acceptStory(generation, story.id)) return;
        pi.sendUserMessage(buildAutoModePrompt(story));
      } catch (error) {
        if (active !== state || !autoMode.fail(generation)) return;
        ctx.ui.notify(`Auto-Modus gestoppt: ${messageOf(error)}`, "error");
      }
    };

    pi.on("session_start", async (_event, ctx) => {
      const generation = ++activationGeneration;
      autoMode.disable();
      statusUpdateGeneration += 1;
      active = undefined;
      disabledForSession = false;
      reviewGate.reset();
      pendingReviews.clear();
      usageTracker.reset();
      usageReporter.reset();
      hintedStoryIds.clear();
      pendingFileChanges.clear();
      ctx.ui.setStatus("trellis", undefined);

      try {
        const project = await findTrellisProject(ctx.cwd, dependencies.readTextFile);
        if (activationGeneration !== generation || disabledForSession) return;
        await activate(ctx, project);
      } catch {
        // A project without a valid trellis-project line keeps the normal startup behavior.
      }
    });

    pi.registerCommand("trellis:on", {
      description: "Trellis-Modus aktivieren",
      handler: async (_args, ctx) => activate(ctx),
    });

    pi.registerCommand("trellis:off", {
      description: "Trellis-Modus deaktivieren",
      handler: async (_args, ctx) => {
        disabledForSession = true;
        autoMode.disable();
        activationGeneration += 1;
        statusUpdateGeneration += 1;
        active = undefined;
        usageTracker.reset();
        ctx.ui.setStatus("trellis", undefined);
        emit("Trellis-Modus deaktiviert.");
      },
    });

    pi.registerCommand("trellis:auto", {
      description: "Auto-Modus für fortlaufende Story-Umsetzung steuern",
      handler: async (args, ctx) => {
        const action = parseAutoModeAction(args);
        if (!action) {
          emit("Usage: /trellis:auto on|off");
          return;
        }
        if (action === "off") {
          autoMode.disable();
          emit("Auto-Modus deaktiviert.");
          return;
        }
        const state = active;
        if (!state) {
          emit("/trellis:auto on erfordert einen aktiven Trellis-Modus. Führe zuerst /trellis:on aus.");
          return;
        }
        const generation = autoMode.enable();
        emit("Auto-Modus aktiviert.");
        await requestNextStory(state, generation, ctx);
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

    pi.registerCommand("trellis:init", {
      description: "Trellis-Onboarding oder geführtes Projekt-Interview starten",
      handler: async (_args, ctx) => {
        try {
          await findTrellisProject(ctx.cwd, dependencies.readTextFile);
          pi.sendUserMessage(INTERVIEW_PROMPT);
        } catch {
          pi.sendUserMessage(ONBOARDING_INTERVIEW_PROMPT);
        }
      },
    });

    pi.registerCommand("trellis:review", {
      description: "Große Änderungen gegen Architektur-Specs prüfen",
      handler: async (args) => {
        if (!active) {
          emit("/trellis:review erfordert einen aktiven Trellis-Modus. Führe zuerst /trellis:on aus.");
          return;
        }
        pi.sendUserMessage(buildReviewPrompt(args));
      },
    });

    pi.registerCommand("trellis:check", {
      description: "Specs, Glossar und Relikte mit Subagent-Rezepten prüfen",
      handler: async () => {
        if (!active) {
          emit("/trellis:check erfordert einen aktiven Trellis-Modus. Führe zuerst /trellis:on aus.");
          return;
        }
        pi.sendUserMessage(CHECK_PROMPT);
      },
    });

    pi.on("tool_call", async (event, ctx) => {
      const input = event.input as Record<string, unknown>;
      const finishStoryId = finishStoryIdFromToolCall(event.toolName, input);
      if (finishStoryId) {
        const decision = reviewGate.finish(finishStoryId);
        if (decision.block) return { block: true, reason: decision.reason };
        if (decision.warning) ctx.ui.notify(decision.warning, "warning");
        return;
      }

      const reviewer = reviewerFromAgentToolCall(event.toolName, input);
      if (reviewer) {
        const overviewStoryId = selectInProgressStory(active?.lastOverview, ctx.cwd).storyId;
        const storyId = reviewGate.storyForReviewSpawn(overviewStoryId);
        if (!storyId) return;
        input.run_in_background = false;
        pendingReviews.set(event.toolCallId, { storyId, reviewer });
        return;
      }

      if (event.toolName !== "edit" && event.toolName !== "write") return;
      const state = active;
      if (!state) return;
      const pathInput = event.input as { path?: unknown };
      if (typeof pathInput.path !== "string" || pathInput.path.length === 0) return;
      const absolutePath = normalizeFilePath(pathInput.path, ctx.cwd);
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
      if (event.isError === false) {
        const storyId = finishStoryIdFromToolCall(
          event.toolName,
          event.input as Record<string, unknown>,
        );
        if (storyId) autoMode.recordSuccessfulFinish(storyId);
      }

      const pendingReview = pendingReviews.get(event.toolCallId);
      pendingReviews.delete(event.toolCallId);
      if (pendingReview) {
        if (event.isError === false) {
          reviewGate.recordSuccess(pendingReview.storyId, pendingReview.reviewer);
        }
        return;
      }

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

    pi.on("turn_start", async (_event, ctx) => {
      usageTracker.beginTurn(active?.lastOverview, ctx.cwd);
    });

    pi.on("session_shutdown", async () => {
      usageTracker.reset();
      usageReporter.reset();
      notifyUsageWarning = undefined;
      stopCompletedUsage();
      stopFailedUsage();
    });

    pi.on("agent_settled", async (_event, ctx) => {
      const generation = autoMode.consumeSettled();
      if (generation === undefined) return;
      const state = active;
      if (!state) {
        autoMode.fail(generation);
        return;
      }

      if (shouldCompactContext(ctx.getContextUsage(), ctx.model?.contextWindow)) {
        if (!autoMode.startCompaction(generation)) return;
        ctx.compact({
          customInstructions: "Erhalte abgeschlossene Trellis-Arbeit, aktuelle Story-Entscheidungen und nächste Schritte.",
          onComplete: () => {
            if (active !== state || !autoMode.startNextQuery(generation)) return;
            void requestNextStory(state, generation, ctx);
          },
          onError: (error) => {
            if (active !== state || !autoMode.fail(generation)) return;
            ctx.ui.notify(`Auto-Modus gestoppt: Compaction fehlgeschlagen: ${error.message}`, "error");
          },
        });
        return;
      }

      if (!autoMode.startNextQuery(generation)) return;
      await requestNextStory(state, generation, ctx);
    });

    pi.on("context", (event, ctx) => {
      const state = active;
      if (!state) return undefined;
      return {
        messages: pruneContextMessages(event.messages, {
          cwd: ctx.cwd,
          projectRoot: state.project.root,
          readMaxAgeTurns: contextReadMaxAgeTurns,
        }),
      };
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
      usageTracker.updateTurnStartOverview(overview, ctx.cwd);
      const contextBlock = formatTrellisContext(overview, {
        isReviewUnlocked: (storyId) => reviewGate.isUnlocked(storyId),
      });
      return { systemPrompt: `${event.systemPrompt}\n\n${contextBlock}` };
    });

    pi.on("turn_end", async (event, ctx) => {
      const state = active;
      notifyUsageWarning = (message) => ctx.ui.notify(message, "warning");
      let endOverview: TrellisOverview | undefined;

      if (state) {
        const updateGeneration = ++statusUpdateGeneration;
        try {
          const overview = addWorktreePaths(
            await getOverview(state.project.id, ctx.signal),
            state.project.root,
          );
          if (active === state && statusUpdateGeneration === updateGeneration) {
            state.lastOverview = overview;
            endOverview = overview;
            ctx.ui.setStatus("trellis", ctx.ui.theme.fg("dim", formatStatusLine(overview)));
          }
        } catch {
          if (active === state && statusUpdateGeneration === updateGeneration) {
            ctx.ui.setStatus("trellis", ctx.ui.theme.fg("error", "trellis: unreachable"));
          }
        }
      }

      const usageDelta = usageTracker.endTurn(event.message, endOverview, ctx.cwd);
      if (state && active === state && usageDelta) {
        usageReporter.add(state.project.id, usageDelta);
      }
      usageReporter.flush();
    });
  };
}

export const TRELLIS_EXTENSION_OWNER_KEY = Symbol.for("pi-trellis:extension-owner");
const TRELLIS_ACTIVATION_PROBE = "pi-trellis:activation-probe";

interface TrellisExtensionOwner {
  duplicatePending: boolean;
}

interface TrellisExtensionRegistry {
  owners: Set<TrellisExtensionOwner>;
}

interface TrellisActivationProbe {
  claimed: boolean;
}

export function createProcessGuardedTrellisExtension(
  extension = createTrellisExtension(),
): (pi: ExtensionAPI) => void {
  return (pi) => {
    const registry = trellisExtensionRegistry();
    const probe: TrellisActivationProbe = { claimed: false };
    pi.events.emit(TRELLIS_ACTIVATION_PROBE, probe);
    if (probe.claimed) return;

    const owner: TrellisExtensionOwner = { duplicatePending: false };
    registry.owners.add(owner);
    pi.events.on(TRELLIS_ACTIVATION_PROBE, (data) => {
      if (!isTrellisActivationProbe(data)) return;
      data.claimed = true;
      owner.duplicatePending = true;
    });
    extension(withDuplicateLoadNotice(pi, owner));
  };
}

function trellisExtensionRegistry(): TrellisExtensionRegistry {
  const globalRegistry = globalThis as typeof globalThis & Record<symbol, unknown>;
  const existing = globalRegistry[TRELLIS_EXTENSION_OWNER_KEY];
  if (isTrellisExtensionRegistry(existing)) return existing;
  const created: TrellisExtensionRegistry = { owners: new Set() };
  globalRegistry[TRELLIS_EXTENSION_OWNER_KEY] = created;
  return created;
}

function isTrellisExtensionRegistry(value: unknown): value is TrellisExtensionRegistry {
  return typeof value === "object" && value !== null &&
    "owners" in value && value.owners instanceof Set;
}

function isTrellisActivationProbe(value: unknown): value is TrellisActivationProbe {
  return typeof value === "object" && value !== null &&
    "claimed" in value && typeof value.claimed === "boolean";
}

function withDuplicateLoadNotice(
  pi: ExtensionAPI,
  owner: TrellisExtensionOwner,
): ExtensionAPI {
  return new Proxy(pi, {
    get(target, property, receiver) {
      if (property !== "on") return Reflect.get(target, property, receiver);
      const register = target.on.bind(target) as (
        event: string,
        handler: (event: unknown, ctx: ExtensionContext) => unknown,
      ) => void;
      return (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
        if (event !== "session_start") {
          register(event, handler);
          return;
        }
        register(event, async (sessionEvent, ctx) => {
          if (owner.duplicatePending) {
            owner.duplicatePending = false;
            ctx.ui.notify("Doppel-Load erkannt; zweite pi-trellis-Instanz übersprungen.", "info");
          }
          return handler(sessionEvent, ctx);
        });
      };
    },
  });
}

export default createProcessGuardedTrellisExtension();

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
