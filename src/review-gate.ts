import { transitionFromToolCall } from "./token-usage.js";

export const REVIEWERS = [
  "pre-finish-review",
  "relic-hunter",
  "spec-sync-check",
  "glossary-warden",
  "change-review",
] as const;

export type Reviewer = typeof REVIEWERS[number];

export const REVIEW_GATE_INSTRUCTION = [
  "Führe jetzt alle fünf Reviewer read-only über das Agent-Tool aus:",
  REVIEWERS.join(", ") + ".",
  "Starte alle fünf Prüfungen parallel in einem gemeinsamen Tool-Turn.",
  "Die Extension erzwingt run_in_background=false und zählt ausschließlich erfolgreiche Agent-Ergebnisse.",
  "Wiege anschließend die Befunde und rufe finish für dieselbe Story erneut auf.",
].join(" ");

interface StoryReviewState {
  blocks: number;
  successful: Set<Reviewer>;
  unlocked: boolean;
}

export interface ReviewGateDecision {
  block: boolean;
  reason?: string;
  warning?: string;
}

export class ReviewGate {
  private readonly stories = new Map<string, StoryReviewState>();
  private lastBlockedStoryId: string | undefined;

  finish(storyId: string): ReviewGateDecision {
    const state = this.state(storyId);
    if (state.unlocked) return { block: false };

    if (state.successful.size === REVIEWERS.length) {
      state.unlocked = true;
      if (this.lastBlockedStoryId === storyId) this.lastBlockedStoryId = undefined;
      return { block: false };
    }

    if (state.blocks >= 3) {
      state.unlocked = true;
      if (this.lastBlockedStoryId === storyId) this.lastBlockedStoryId = undefined;
      return {
        block: false,
        warning: `Review-Gate für ${storyId} lässt finish nach drei Blocks ohne vollständige Review-Nachweise passieren.`,
      };
    }

    state.blocks += 1;
    this.lastBlockedStoryId = storyId;
    return {
      block: true,
      reason: reviewGateReason(storyId, this.missingReviewers(storyId), state.blocks),
    };
  }

  storyForReviewSpawn(): string | undefined {
    const storyId = this.lastBlockedStoryId;
    if (!storyId || this.state(storyId).unlocked) return undefined;
    return storyId;
  }

  recordSuccess(storyId: string, reviewer: Reviewer): void {
    const state = this.state(storyId);
    if (state.unlocked) return;
    state.successful.add(reviewer);
    if (state.successful.size === REVIEWERS.length) {
      state.unlocked = true;
      if (this.lastBlockedStoryId === storyId) this.lastBlockedStoryId = undefined;
    }
  }

  missingReviewers(storyId: string): Reviewer[] {
    const successful = this.state(storyId).successful;
    return REVIEWERS.filter((reviewer) => !successful.has(reviewer));
  }

  reset(): void {
    this.stories.clear();
    this.lastBlockedStoryId = undefined;
  }

  private state(storyId: string): StoryReviewState {
    let state = this.stories.get(storyId);
    if (!state) {
      state = { blocks: 0, successful: new Set(), unlocked: false };
      this.stories.set(storyId, state);
    }
    return state;
  }
}

export function reviewerFromAgentToolCall(
  toolName: string,
  input: Record<string, unknown>,
): Reviewer | undefined {
  if (toolName !== "Agent") return undefined;
  return typeof input.subagent_type === "string" && isReviewer(input.subagent_type)
    ? input.subagent_type
    : undefined;
}

export function finishStoryIdFromToolCall(
  toolName: string,
  input: Record<string, unknown>,
): string | undefined {
  const transition = transitionFromToolCall(toolName, input);
  return transition?.action === "finish" ? transition.storyId : undefined;
}

export function reviewGateReason(
  storyId: string,
  missing: readonly Reviewer[] = REVIEWERS,
  blockCount = 1,
): string {
  const failOpen = blockCount === 3
    ? " Achtung: Der nächste finish-Aufruf wird zum Deadlock-Schutz mit Warnung durchgelassen."
    : "";
  return `Review-Runde für ${storyId}: ${REVIEW_GATE_INSTRUCTION} Fehlend: ${missing.join(", ")}.${failOpen}`;
}

function isReviewer(value: string): value is Reviewer {
  return (REVIEWERS as readonly string[]).includes(value);
}
