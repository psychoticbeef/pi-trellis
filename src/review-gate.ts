export const REVIEW_GATE_INSTRUCTION = [
  "Der erste finish-Aufruf dieser Story wird für die Review-Runde verzögert.",
  "Führe jetzt pre-finish-review und relic-hunter read-only aus:",
  "Nutze das Agent-Tool, falls verfügbar, und starte beide Prüfungen parallel.",
  "Falls das Agent-Tool nicht verfügbar ist, führe beide Prüfungen selbst inline durch.",
  "Wiege anschließend die Befunde und rufe finish für dieselbe Story erneut auf.",
  "Die Extension verfolgt die Reviews nicht; der nächste finish-Aufruf wird nicht erneut blockiert.",
].join(" ");

export function finishStoryIdFromToolCall(
  toolName: string,
  input: Record<string, unknown>,
): string | undefined {
  if (isDirectTrellisTransition(toolName)) {
    return finishStoryId(input);
  }

  if (toolName !== "mcp") return undefined;
  if (input.server !== undefined && input.server !== "trellis") return undefined;
  if (input.tool !== "transition" && input.tool !== "trellis_transition") return undefined;

  const args = parseArgs(input.args);
  return args ? finishStoryId(args) : undefined;
}

export function reviewGateReason(storyId: string): string {
  return `Review-Runde für ${storyId}: ${REVIEW_GATE_INSTRUCTION}`;
}

function isDirectTrellisTransition(toolName: string): boolean {
  return toolName === "trellis_transition" ||
    toolName === "mcp__trellis__transition" ||
    toolName.endsWith(".trellis_transition");
}

function finishStoryId(input: Record<string, unknown>): string | undefined {
  if (input.action !== "finish") return undefined;
  return typeof input.story_id === "string" && input.story_id.length > 0
    ? input.story_id
    : undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
