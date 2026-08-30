import { isAbsolute, relative, resolve, sep } from "node:path";
import type { StoryForPath } from "./mcp-client.js";

export function normalizeFilePath(path: string, cwd: string): string {
  const withoutMention = path.startsWith("@") ? path.slice(1) : path;
  return resolve(cwd, withoutMention);
}

export function projectPath(absolutePath: string, projectRoot: string): string {
  const candidate = relative(projectRoot, absolutePath);
  if (candidate === "") return ".";
  if (candidate === ".." || candidate.startsWith(`..${sep}`) || isAbsolute(candidate)) {
    return absolutePath;
  }
  return candidate.split(sep).join("/");
}

export function selectUnhintedDoneStories(
  stories: StoryForPath[],
  hintedStoryIds: ReadonlySet<string>,
): StoryForPath[] {
  const selected: StoryForPath[] = [];
  const seen = new Set(hintedStoryIds);
  for (const story of stories) {
    if (story.status !== "done" || seen.has(story.id)) continue;
    seen.add(story.id);
    selected.push(story);
  }
  return selected;
}

export function formatFileHint(path: string, story: StoryForPath): string {
  return `Datei ${path} betrifft Story ${story.id} (${story.title}) – sind deren Specs/Tests noch aktuell?`;
}
