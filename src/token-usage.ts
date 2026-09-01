export type TrellisTransitionAction = "start" | "finish";

export interface TrellisTransition {
  action: TrellisTransitionAction;
  storyId: string;
}

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

export class StoryUsageTracker {
  private activeStoryId: string | undefined;
  private turnStoryId: string | undefined;
  private finishAfterTurn: string | undefined;
  private turnOpen = false;
  private turnSubagentTokens = 0;
  private betweenTurnSubagentTokens = 0;
  private readonly pendingTransitions = new Map<string, TrellisTransition>();
  private readonly seenSubagentRecords = new Set<string>();

  beginTurn(): void {
    this.closeFinishedStory();
    this.turnOpen = true;
    this.turnStoryId = this.activeStoryId;
    this.finishAfterTurn = undefined;
    this.turnSubagentTokens = this.betweenTurnSubagentTokens;
    this.betweenTurnSubagentTokens = 0;
  }

  recordTransitionCall(
    toolCallId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): void {
    const transition = transitionFromToolCall(toolName, input);
    if (transition) this.pendingTransitions.set(toolCallId, transition);
  }

  recordTransitionResult(toolCallId: string, isError: boolean): TrellisTransition | undefined {
    const transition = this.pendingTransitions.get(toolCallId);
    this.pendingTransitions.delete(toolCallId);
    if (!transition || isError) return undefined;

    if (transition.action === "start") {
      this.activeStoryId = transition.storyId;
      this.turnStoryId = transition.storyId;
      return transition;
    }

    if (this.activeStoryId === transition.storyId) {
      this.turnStoryId = transition.storyId;
      this.finishAfterTurn = transition.storyId;
    }
    return transition;
  }

  recordSubagent(record: unknown): void {
    if (!isRecord(record)) return;
    const id = record.id;
    if (typeof id !== "string" || id.length === 0 || this.seenSubagentRecords.has(id)) return;
    this.seenSubagentRecords.add(id);

    const tokens = usageTotalTokens(record.usage);
    if (tokens === undefined) return;
    if (this.turnOpen) {
      this.turnSubagentTokens += tokens;
    } else if (this.activeStoryId) {
      this.betweenTurnSubagentTokens += tokens;
    }
  }

  endTurn(message: unknown): UsageDelta | undefined {
    const storyId = this.turnStoryId;
    const main = assistantTotalTokens(message);
    const subagents = this.turnSubagentTokens;

    this.turnOpen = false;
    this.turnStoryId = undefined;
    this.turnSubagentTokens = 0;

    if (!storyId || (main === 0 && subagents === 0)) return undefined;
    return { storyId, main, subagents };
  }

  closeFinishedStory(): void {
    if (this.finishAfterTurn && this.activeStoryId === this.finishAfterTurn) {
      this.activeStoryId = undefined;
    }
    this.finishAfterTurn = undefined;
  }

  reset(): void {
    this.activeStoryId = undefined;
    this.turnStoryId = undefined;
    this.finishAfterTurn = undefined;
    this.turnOpen = false;
    this.turnSubagentTokens = 0;
    this.betweenTurnSubagentTokens = 0;
    this.pendingTransitions.clear();
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

export function transitionFromToolCall(
  toolName: string,
  input: Record<string, unknown>,
): TrellisTransition | undefined {
  if (isDirectTrellisTransition(toolName)) return transitionFromInput(input);

  if (toolName !== "mcp") return undefined;
  if (input.server !== undefined && input.server !== "trellis") return undefined;
  if (input.tool !== "transition" && input.tool !== "trellis_transition") return undefined;

  const args = parseArgs(input.args);
  return args ? transitionFromInput(args) : undefined;
}

export function assistantTotalTokens(message: unknown): number {
  if (!isRecord(message) || message.role !== "assistant") return 0;
  return usageTotalTokens(message.usage) ?? 0;
}

function usageTotalTokens(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  const totalTokens = value.totalTokens;
  return typeof totalTokens === "number" && Number.isSafeInteger(totalTokens) && totalTokens >= 0
    ? totalTokens
    : undefined;
}

function transitionFromInput(input: Record<string, unknown>): TrellisTransition | undefined {
  if (input.action !== "start" && input.action !== "finish") return undefined;
  if (typeof input.story_id !== "string" || input.story_id.length === 0) return undefined;
  return { action: input.action, storyId: input.story_id };
}

function isDirectTrellisTransition(toolName: string): boolean {
  return toolName === "trellis_transition" ||
    toolName === "mcp__trellis__transition" ||
    toolName.endsWith(".trellis_transition");
}

function parseArgs(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
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
