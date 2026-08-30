import type { StoryOverview, TrellisOverview } from "./context.js";

export const MAX_STATUS_SUMMARY_LENGTH = 1000;
const STATUSES = ["todo", "refined", "in_progress", "done"];

export function formatKanbanStatus(overview: TrellisOverview): string {
  const stories = overview.stories ?? [];
  const counts = new Map<string, number>();
  for (const story of stories) {
    const status = compact(story.status || "unknown");
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const extraStatuses = [...counts.keys()].filter((status) => !STATUSES.includes(status)).sort();
  const kanban = [...STATUSES, ...extraStatuses]
    .map((status) => `${status}=${counts.get(status) ?? 0}`)
    .join(" | ");
  const inProgress = stories
    .filter((story) => story.status === "in_progress")
    .map(renderInProgress);
  const stale = (overview.stale_nodes ?? []).map(renderNode);
  const blocked = stories
    .filter((story) => story.gates_open === false)
    .map((story) => `${compact(story.id || "?")} ${compact(story.title || "-")}`);

  const summary = [
    `Kanban | ${clip(kanban, 220)}`,
    `in_progress | ${summarize(inProgress, 300)}`,
    `stale | ${summarize(stale, 200)}`,
    `blocked_gates | ${summarize(blocked, 180)}`,
  ].join("\n");

  if (summary.length > MAX_STATUS_SUMMARY_LENGTH) {
    throw new Error(`Kanban-Zusammenfassung überschreitet das Limit: ${summary.length}`);
  }
  return summary;
}

export function formatStatusLine(overview: TrellisOverview): string {
  const active = (overview.stories ?? []).filter((story) => story.status === "in_progress");
  if (active.length === 0) return "trellis: idle";
  const first = active[0];
  const suffix = active.length > 1 ? `+${active.length - 1}` : "";
  const gates = active.some((story) => story.gates_open === false) ? "blocked" : "open";
  return clip(`trellis: ${compact(first.id || "?")}${suffix} | gates ${gates}`, 120);
}

function renderInProgress(story: StoryOverview): string {
  const worktree = story.worktree_path ?? story.worktreePath ?? "-";
  return `${compact(story.id || "?")} ${compact(story.title || "-")} worktree=${compact(worktree)}`;
}

function renderNode(value: unknown): string {
  if (typeof value === "string") return compact(value);
  if (typeof value !== "object" || value === null) return compact(String(value));
  const node = value as Record<string, unknown>;
  return [node.id, node.kind, node.title]
    .filter((part) => typeof part === "string" && part.length > 0)
    .map((part) => compact(String(part)))
    .join(" ") || "unknown";
}

function summarize(items: string[], limit: number): string {
  if (items.length === 0) return "none";
  let result = "";
  for (let index = 0; index < items.length; index += 1) {
    const separator = result ? "; " : "";
    const omitted = items.length - index - 1;
    const marker = omitted > 0 ? ` …(+${omitted})` : "";
    const candidate = result + separator + compact(items[index]);
    if ((candidate + marker).length <= limit) {
      result = candidate;
      continue;
    }
    if (!result) return `${clip(compact(items[index]), Math.max(1, limit - marker.length))}${marker}`;
    return `${clip(result, Math.max(1, limit - marker.length))}${marker}`;
  }
  return clip(result, limit);
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clip(value: string, limit: number): string {
  if (value.length <= limit) return value;
  if (limit <= 1) return "…".slice(0, limit);
  return `${value.slice(0, limit - 1)}…`;
}
