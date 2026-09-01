import { resolve } from "node:path";
import type { StoryOverview, TrellisOverview } from "./context.js";

export interface UsageCategories {
  input: bigint;
  output: bigint;
  cacheRead: bigint;
  cacheWrite: bigint;
}

export interface UsageAmount {
  categories: UsageCategories;
  legacy: bigint;
}

export interface UsageDelta {
  storyId: string;
  main: UsageAmount;
  subagents: UsageAmount;
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
  private turnSubagentUsage = emptyUsageAmount();
  private betweenTurnSubagentUsage = emptyUsageAmount();
  private readonly seenSubagentRecords = new Set<string>();

  constructor(private readonly warn: (message: string) => void = () => {}) {}

  beginTurn(overview?: TrellisOverview, cwd = ""): void {
    this.turnOpen = true;
    this.turnStartOverview = overview;
    this.turnCwd = cwd;
    this.turnSubagentUsage = cloneUsageAmount(this.betweenTurnSubagentUsage);
    this.betweenTurnSubagentUsage = emptyUsageAmount();
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

    const usage = normalizeUsage(record.usage);
    if (!usage) return;
    if (this.turnOpen) addUsageAmount(this.turnSubagentUsage, usage);
    else addUsageAmount(this.betweenTurnSubagentUsage, usage);
  }

  endTurn(message: unknown, overview?: TrellisOverview, cwd = this.turnCwd): UsageDelta | undefined {
    const main = assistantUsage(message);
    const subagents = cloneUsageAmount(this.turnSubagentUsage);
    const selection = selectTurnStory(this.turnStartOverview, overview, this.turnCwd, cwd);

    this.turnOpen = false;
    this.turnStartOverview = undefined;
    this.turnCwd = "";
    this.turnSubagentUsage = emptyUsageAmount();

    if (usageAmountTotal(main) === 0n && usageAmountTotal(subagents) === 0n) return undefined;
    if (selection.ambiguous) this.warn(ambiguousUsageWarning());
    if (!selection.storyId) return undefined;
    return { storyId: selection.storyId, main, subagents };
  }

  reset(): void {
    this.turnStartOverview = undefined;
    this.turnCwd = "";
    this.turnOpen = false;
    this.turnSubagentUsage = emptyUsageAmount();
    this.betweenTurnSubagentUsage = emptyUsageAmount();
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
      addUsageAmount(current.main, delta.main);
      addUsageAmount(current.subagents, delta.subagents);
      return;
    }
    this.pending.set(key, {
      projectId,
      storyId: delta.storyId,
      main: cloneUsageAmount(delta.main),
      subagents: cloneUsageAmount(delta.subagents),
    });
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
      const snapshot = clonePendingUsage(pending);

      if (categorizedTotal(snapshot) > 0n) {
        const succeeded = await this.report(
          pending,
          categorizedUsageArguments(pending, snapshot),
          generation,
        );
        if (generation !== this.generation) break;
        if (succeeded) subtractCategories(pending, snapshot);
      }

      if (legacyTotal(snapshot) > 0n) {
        const succeeded = await this.report(
          pending,
          legacyUsageArguments(pending, snapshot),
          generation,
        );
        if (generation !== this.generation) break;
        if (succeeded) subtractLegacy(pending, snapshot);
      }

      if (usageAmountTotal(pending.main) === 0n && usageAmountTotal(pending.subagents) === 0n) {
        this.pending.delete(key);
      }
    }

    this.running = false;
    const retryRequested = this.flushRequested;
    this.flushRequested = false;
    if (retryRequested && this.pending.size > 0) {
      void this.flushPending(this.generation);
    }
  }

  private async report(
    pending: PendingUsage,
    args: string[],
    generation: number,
  ): Promise<boolean> {
    try {
      const result = await this.run("trellis", args);
      if (generation !== this.generation) return false;
      if (result.code !== 0) {
        this.warn(usageWarning(pending, result.stderr || `Exit-Code ${result.code}`));
        return false;
      }
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.warn(usageWarning(pending, messageOf(error)));
      return false;
    }
  }
}

export function assistantTotalTokens(message: unknown): number {
  if (!isRecord(message) || message.role !== "assistant") return 0;
  return usageTotalTokens(message.usage) ?? 0;
}

function assistantUsage(message: unknown): UsageAmount {
  if (!isRecord(message) || message.role !== "assistant") return emptyUsageAmount();
  return normalizeUsage(message.usage) ?? emptyUsageAmount();
}

function normalizeUsage(value: unknown): UsageAmount | undefined {
  const totalTokens = usageTotalTokens(value);
  if (totalTokens === undefined || !isRecord(value)) return undefined;

  const input = usageField(value.input);
  const output = usageField(value.output);
  const cacheRead = usageField(value.cacheRead);
  const cacheWrite = usageField(value.cacheWrite);
  if (
    input !== undefined && output !== undefined &&
    cacheRead !== undefined && cacheWrite !== undefined &&
    BigInt(input) + BigInt(output) + BigInt(cacheRead) + BigInt(cacheWrite) === BigInt(totalTokens)
  ) {
    return {
      categories: {
        input: BigInt(input),
        output: BigInt(output),
        cacheRead: BigInt(cacheRead),
        cacheWrite: BigInt(cacheWrite),
      },
      legacy: 0n,
    };
  }
  return { categories: emptyCategories(), legacy: BigInt(totalTokens) };
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
  return usageField(value.totalTokens);
}

function usageField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function categorizedUsageArguments(pending: PendingUsage, snapshot: PendingUsage): string[] {
  return [
    "usage", "add", pending.projectId, pending.storyId,
    "--main-input", String(snapshot.main.categories.input),
    "--main-output", String(snapshot.main.categories.output),
    "--main-cache-read", String(snapshot.main.categories.cacheRead),
    "--main-cache-write", String(snapshot.main.categories.cacheWrite),
    "--subagents-input", String(snapshot.subagents.categories.input),
    "--subagents-output", String(snapshot.subagents.categories.output),
    "--subagents-cache-read", String(snapshot.subagents.categories.cacheRead),
    "--subagents-cache-write", String(snapshot.subagents.categories.cacheWrite),
  ];
}

function legacyUsageArguments(pending: PendingUsage, snapshot: PendingUsage): string[] {
  return [
    "usage", "add", pending.projectId, pending.storyId,
    "--main", String(snapshot.main.legacy),
    "--subagents", String(snapshot.subagents.legacy),
  ];
}

function emptyCategories(): UsageCategories {
  return { input: 0n, output: 0n, cacheRead: 0n, cacheWrite: 0n };
}

function emptyUsageAmount(): UsageAmount {
  return { categories: emptyCategories(), legacy: 0n };
}

function cloneUsageAmount(usage: UsageAmount): UsageAmount {
  return { categories: { ...usage.categories }, legacy: usage.legacy };
}

function clonePendingUsage(pending: PendingUsage): PendingUsage {
  return {
    projectId: pending.projectId,
    storyId: pending.storyId,
    main: cloneUsageAmount(pending.main),
    subagents: cloneUsageAmount(pending.subagents),
  };
}

function addUsageAmount(target: UsageAmount, delta: UsageAmount): void {
  target.categories.input += delta.categories.input;
  target.categories.output += delta.categories.output;
  target.categories.cacheRead += delta.categories.cacheRead;
  target.categories.cacheWrite += delta.categories.cacheWrite;
  target.legacy += delta.legacy;
}

function usageAmountTotal(usage: UsageAmount): bigint {
  return usage.categories.input + usage.categories.output +
    usage.categories.cacheRead + usage.categories.cacheWrite + usage.legacy;
}

function categorizedTotal(usage: UsageDelta): bigint {
  return usage.main.categories.input + usage.main.categories.output +
    usage.main.categories.cacheRead + usage.main.categories.cacheWrite +
    usage.subagents.categories.input + usage.subagents.categories.output +
    usage.subagents.categories.cacheRead + usage.subagents.categories.cacheWrite;
}

function legacyTotal(usage: UsageDelta): bigint {
  return usage.main.legacy + usage.subagents.legacy;
}

function subtractCategories(target: UsageDelta, snapshot: UsageDelta): void {
  target.main.categories.input -= snapshot.main.categories.input;
  target.main.categories.output -= snapshot.main.categories.output;
  target.main.categories.cacheRead -= snapshot.main.categories.cacheRead;
  target.main.categories.cacheWrite -= snapshot.main.categories.cacheWrite;
  target.subagents.categories.input -= snapshot.subagents.categories.input;
  target.subagents.categories.output -= snapshot.subagents.categories.output;
  target.subagents.categories.cacheRead -= snapshot.subagents.categories.cacheRead;
  target.subagents.categories.cacheWrite -= snapshot.subagents.categories.cacheWrite;
}

function subtractLegacy(target: UsageDelta, snapshot: UsageDelta): void {
  target.main.legacy -= snapshot.main.legacy;
  target.subagents.legacy -= snapshot.subagents.legacy;
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
