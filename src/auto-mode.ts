export type AutoModeAction = "on" | "off";

export interface NextStoryCandidate {
  id: string;
  title: string;
}

export interface ContextUsageSnapshot {
  tokens: number | null;
}

type AutoModePhase =
  | "off"
  | "querying"
  | "implementing"
  | "awaiting-settled"
  | "continuing"
  | "compacting";

export function parseAutoModeAction(args: string): AutoModeAction | undefined {
  const value = args.trim();
  return value === "on" || value === "off" ? value : undefined;
}

export function selectFirstNextStory(
  result: { candidates: readonly NextStoryCandidate[] },
): NextStoryCandidate | undefined {
  return result.candidates[0];
}

export function buildAutoModePrompt(story: NextStoryCandidate): string {
  return [
    `Auto-Modus: Bearbeite jetzt ${story.id} „${story.title}“.`,
    "Lies vollständigen Trellis-Spec-Baum und relevante Done-Specs.",
    `Rufe für ${story.id} trellis_transition mit action=start auf, implementiere alle Acceptance Criteria, führe Tests und Reviews aus und rufe danach finish für ${story.id} auf.`,
    "Arbeite ausschließlich in von Trellis bereitgestelltem Story-Worktree.",
  ].join(" ");
}

export function shouldCompactContext(
  usage: ContextUsageSnapshot | undefined,
  modelContextWindow: number | undefined,
): boolean {
  if (
    usage?.tokens === null ||
    usage?.tokens === undefined ||
    !Number.isFinite(usage.tokens) ||
    usage.tokens < 0 ||
    modelContextWindow === undefined ||
    !Number.isFinite(modelContextWindow) ||
    modelContextWindow <= 0
  ) {
    return false;
  }
  return usage.tokens / modelContextWindow > 0.75;
}

export class AutoMode {
  private generation = 0;
  private phase: AutoModePhase = "off";
  private storyId: string | undefined;

  enable(): number {
    this.generation += 1;
    this.phase = "querying";
    this.storyId = undefined;
    return this.generation;
  }

  disable(): void {
    this.generation += 1;
    this.phase = "off";
    this.storyId = undefined;
  }

  acceptStory(generation: number, storyId: string): boolean {
    if (!this.is(generation, "querying")) return false;
    this.phase = "implementing";
    this.storyId = storyId;
    return true;
  }

  finishWithoutStory(generation: number): boolean {
    if (!this.is(generation, "querying")) return false;
    this.disable();
    return true;
  }

  fail(generation: number): boolean {
    if (generation !== this.generation || this.phase === "off") return false;
    this.disable();
    return true;
  }

  recordSuccessfulFinish(storyId: string): boolean {
    if (this.phase !== "implementing" || this.storyId !== storyId) return false;
    this.phase = "awaiting-settled";
    return true;
  }

  consumeSettled(): number | undefined {
    if (this.phase !== "awaiting-settled") return undefined;
    this.phase = "continuing";
    return this.generation;
  }

  startCompaction(generation: number): boolean {
    if (!this.is(generation, "continuing")) return false;
    this.phase = "compacting";
    return true;
  }

  startNextQuery(generation: number): boolean {
    if (
      generation !== this.generation ||
      (this.phase !== "continuing" && this.phase !== "compacting")
    ) {
      return false;
    }
    this.phase = "querying";
    this.storyId = undefined;
    return true;
  }

  isQueryCurrent(generation: number): boolean {
    return this.is(generation, "querying");
  }

  private is(generation: number, phase: AutoModePhase): boolean {
    return this.generation === generation && this.phase === phase;
  }
}
