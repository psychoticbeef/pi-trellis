import { basename, dirname, join } from "node:path";

export const MAX_CONTEXT_LENGTH = 1500;
const STATUSES = ["todo", "refined", "in_progress", "done"];

export interface GlossaryEntry {
  term?: string;
  definition?: string;
}

export interface StoryOverview {
  id?: string;
  title?: string;
  status?: string;
  worktree_path?: string;
  worktreePath?: string;
  gates_open?: boolean;
}

export interface TrellisOverview {
  description?: string;
  glossary?: GlossaryEntry[];
  stories?: StoryOverview[];
  stale_nodes?: unknown[];
}

export function addWorktreePaths(overview: TrellisOverview, projectRoot: string): TrellisOverview {
  return {
    ...overview,
    stories: (overview.stories ?? []).map((story) => {
      if (story.status !== "in_progress" || story.worktree_path || story.worktreePath) return story;
      const id = story.id ?? "unknown";
      const currentIsStoryWorktree = basename(projectRoot) === id && basename(dirname(projectRoot)) === ".trellis-worktrees";
      return {
        ...story,
        worktree_path: currentIsStoryWorktree ? projectRoot : join(projectRoot, ".trellis-worktrees", id),
      };
    }),
  };
}

export function formatTrellisContext(overview: TrellisOverview): string {
  const stories = overview.stories ?? [];
  const counts = new Map<string, number>();
  for (const story of stories) {
    const status = compact(story.status || "unknown");
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const extraStatuses = [...counts.keys()].filter((status) => !STATUSES.includes(status)).sort();
  const kanban = [...STATUSES, ...extraStatuses]
    .map((status) => `${status}=${counts.get(status) ?? 0}`)
    .join(" ");

  const glossary = (overview.glossary ?? []).map((entry) =>
    `${compact(entry.term || "?")}=${compact(entry.definition || "-")}`,
  );
  const active = stories
    .filter((story) => story.status === "in_progress")
    .map((story) => {
      const worktree = story.worktree_path ?? story.worktreePath ?? "-";
      return `${compact(story.id || "?")} ${compact(story.title || "-")} worktree=${compact(worktree)}`;
    });
  const stale = (overview.stale_nodes ?? []).map(renderStaleNode);

  const block = [
    "<trellis-context>",
    `Description: ${clip(compact(overview.description || "-"), 220)}`,
    `Glossar: ${summarize(glossary, 350)}`,
    `Kanban: ${clip(kanban, 160)}`,
    `in_progress: ${summarize(active, 300)}`,
    `stale: ${summarize(stale, 200)}`,
    "</trellis-context>",
  ].join("\n");

  if (block.length >= MAX_CONTEXT_LENGTH) {
    throw new Error(`Trellis-Kontextblock überschreitet das Limit: ${block.length}`);
  }
  return block;
}

function summarize(items: string[], limit: number): string {
  if (items.length === 0) return "none";
  let result = "";
  for (let index = 0; index < items.length; index += 1) {
    const item = compact(items[index]);
    const omitted = items.length - index - 1;
    const marker = omitted > 0 ? ` …(+${omitted})` : "";
    const separator = result ? "; " : "";
    if ((result + separator + item + marker).length <= limit) {
      result += separator + item;
      continue;
    }
    if (!result) return clip(item, Math.max(1, limit - marker.length)) + marker;
    return clip(result, Math.max(1, limit - marker.length)) + marker;
  }
  return clip(result, limit);
}

function renderStaleNode(value: unknown): string {
  if (typeof value === "string") return compact(value);
  if (typeof value !== "object" || value === null) return compact(String(value));
  const node = value as Record<string, unknown>;
  return [node.id, node.kind, node.title]
    .filter((part) => typeof part === "string" && part.length > 0)
    .map((part) => compact(String(part)))
    .join(" ") || "unknown";
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clip(value: string, limit: number): string {
  if (value.length <= limit) return value;
  if (limit <= 1) return "…".slice(0, limit);
  return `${value.slice(0, limit - 1)}…`;
}
