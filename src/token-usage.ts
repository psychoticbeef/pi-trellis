import { resolve } from "node:path";
import type { StoryOverview, TrellisOverview } from "./context.js";

export interface UsageDelta {
  storyId: string;
  main: number;
  subagents: number;
}

export interface UsageCommandResult {
  code: number;
  stderr?: string;
}

export type UsageCommand = (
  command: string,
  args: string[],
) => Promise<UsageCommandResult>;

interface PendingUsage extends UsageDelta {
  projectId: string;
}

export interface StorySelection {
  storyId?: string;
  ambiguous: boolean;
}

export class StoryUsageTracker {
  private turnStartOverview: TrellisOverview | undefined;
  private turnCwd = "";
  private turnOpen = false;
  private turnSubagentTokens = 0;
  private betweenTurnSubagentTokens = 0;
  private readonly seenSubagentRecords = new Set<string>();

  constructor(private readonly warn: (message: string) => void = () => {}) {}

  beginTurn(overview?: TrellisOverview, cwd = ""): void {
    this.turnOpen = true;
    this.turnStartOverview = overview;
    this.turnCwd = cwd;
    this.turnSubagentTokens = this.betweenTurnSubagentTokens;
    this.betweenTurnSubagentTokens = 0;
  }

  updateTurnStartOverview(overview: TrellisOverview, cwd: string): void {
    if (!this.turnOpen) return;
    this.turnStartOverview = overview;
    this.turnCwd = cwd;
  }

  recordSubagent(record: unknown): void {
    if (!isRecord(record)) return;
    const id = record.id;
    if (typeof id !== "string" || id.length === 0 || this.seenSubagentRecords.has(id)) return;
    this.seenSubagentRecords.add(id);

    const tokens = usageTotalTokens(record.usage);
    if (tokens === undefined) return;
    if (this.turnOpen) this.turnSubagentTokens += tokens;
    else this.betweenTurnSubagentTokens += tokens;
  }

  endTurn(message: unknown, overview?: TrellisOverview, cwd = this.turnCwd): UsageDelta | undefined {
    const main = assistantTotalTokens(message);
    const subagents = this.turnSubagentTokens;
    const selection = selectTurnStory(this.turnStartOverview, overview, this.turnCwd, cwd);

    this.turnOpen = false;
    this.turnStartOverview = undefined;
    this.turnCwd = "";
    this.turnSubagentTokens = 0;

    if (main === 0 && subagents === 0) return undefined;
    if (selection.ambiguous) this.warn(ambiguousUsageWarning());
    if (!selection.storyId) return undefined;
    return { storyId: selection.storyId, main, subagents };
  }

  reset(): void {
    this.turnStartOverview = undefined;
    this.turnCwd = "";
    this.turnOpen = false;
    this.turnSubagentTokens = 0;
    this.betweenTurnSubagentTokens = 0;
    this.seenSubagentRecords.clear();
  }
}

export class UsageDeltaReporter {
  private readonly pending = new Map<string, PendingUsage>();
  private running = false;
  private flushRequested = false;
  private generation = 0;

  constructor(
    private readonly run: UsageCommand,
    private readonly warn: (message: string) => void,
  ) {}

  add(projectId: string, delta: UsageDelta): void {
    const key = usageKey(projectId, delta.storyId);
    const current = this.pending.get(key);
    if (current) {
      current.main += delta.main;
      current.subagents += delta.subagents;
      return;
    }
    this.pending.set(key, { projectId, ...delta });
  }

  flush(): void {
    if (this.running) {
      this.flushRequested = true;
      return;
    }
    if (this.pending.size === 0) return;
    void this.flushPending(this.generation);
  }

  reset(): void {
    this.generation += 1;
    this.pending.clear();
    this.flushRequested = false;
  }

  private async flushPending(generation: number): Promise<void> {
    this.running = true;
    this.flushRequested = false;

    for (const [key, pending] of [...this.pending]) {
      if (generation !== this.generation) break;
      const snapshot = { main: pending.main, subagents: pending.subagents };
      try {
        const result = await this.run("trellis", usageArguments(pending, snapshot));
        if (generation !== this.generation) break;
        if (result.code !== 0) {
          this.warn(usageWarning(pending, result.stderr || `Exit-Code ${result.code}`));
          continue;
        }
        const current = this.pending.get(key);
        if (!current) continue;
        current.main -= snapshot.main;
        current.subagents -= snapshot.subagents;
        if (current.main === 0 && current.subagents === 0) this.pending.delete(key);
      } catch (error) {
        if (generation !== this.generation) break;
        this.warn(usageWarning(pending, messageOf(error)));
      }
    }

    this.running = false;
    const retryRequested = this.flushRequested;
    this.flushRequested = false;
    if (retryRequested && this.pending.size > 0) {
      void this.flushPending(this.generation);
    }
  }
}

export function assistantTotalTokens(message: unknown): number {
  if (!isRecord(message) || message.role !== "assistant") return 0;
  return usageTotalTokens(message.usage) ?? 0;
}

function selectTurnStory(
  startOverview: TrellisOverview | undefined,
  endOverview: TrellisOverview | undefined,
  startCwd: string,
  endCwd: string,
): StorySelection {
  const start = selectInProgressStory(startOverview, startCwd);
  if (start.ambiguous) return start;
  if (start.storyId && storyStatus(endOverview, start.storyId) === "done") {
    return { storyId: start.storyId, ambiguous: false };
  }

  const end = selectInProgressStory(endOverview, endCwd);
  if (end.storyId) return end;
  return { ambiguous: start.ambiguous || end.ambiguous };
}

export function selectInProgressStory(
  overview: TrellisOverview | undefined,
  cwd: string,
): StorySelection {
  const stories = (overview?.stories ?? []).filter(
    (story): story is StoryOverview & { id: string } =>
      story.status === "in_progress" && typeof story.id === "string" && story.id.length > 0,
  );
  if (stories.length === 0) return { ambiguous: false };
  if (stories.length === 1) return { storyId: stories[0].id, ambiguous: false };

  const normalizedCwd = normalizePath(cwd);
  const matches = normalizedCwd
    ? stories.filter((story) => normalizePath(story.worktree_path ?? story.worktreePath ?? "") === normalizedCwd)
    : [];
  if (matches.length === 1) return { storyId: matches[0].id, ambiguous: false };
  return { ambiguous: true };
}

function storyStatus(overview: TrellisOverview | undefined, storyId: string): string | undefined {
  return (overview?.stories ?? []).find((story) => story.id === storyId)?.status;
}

function normalizePath(path: string): string | undefined {
  return path.trim().length > 0 ? resolve(path) : undefined;
}

function ambiguousUsageWarning(): string {
  return "Token-Usage nicht attribuiert: mehrere in_progress-Storys ohne eindeutigen Worktree-Pfad für ctx.cwd";
}

function usageTotalTokens(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  const totalTokens = value.totalTokens;
  return typeof totalTokens === "number" && Number.isSafeInteger(totalTokens) && totalTokens >= 0
    ? totalTokens
    : undefined;
}

function usageArguments(
  pending: PendingUsage,
  snapshot: { main: number; subagents: number },
): string[] {
  return [
    "usage",
    "add",
    pending.projectId,
    pending.storyId,
    "--main",
    String(snapshot.main),
    "--subagents",
    String(snapshot.subagents),
  ];
}

function usageKey(projectId: string, storyId: string): string {
  return `${projectId}\0${storyId}`;
}

function usageWarning(pending: PendingUsage, reason: string): string {
  return `Token-Usage für ${pending.storyId} nicht gemeldet: ${reason.trim()}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
