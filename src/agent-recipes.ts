import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const AGENT_RECIPE_NAMES = [
  "change-review.md",
  "glossary-warden.md",
  "pre-finish-review.md",
  "relic-hunter.md",
  "spec-sync-check.md",
] as const;

export type AgentRecipeName = typeof AGENT_RECIPE_NAMES[number];

const recipeDirectoryUrl = new URL("../.pi/agents/", import.meta.url);

export const AGENT_RECIPES = Object.fromEntries(await Promise.all(
  AGENT_RECIPE_NAMES.map(async (name) => [
    name,
    await readFile(new URL(name, recipeDirectoryUrl), "utf8"),
  ]),
)) as Record<AgentRecipeName, string>;

export function agentDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  return environment.PI_CODING_AGENT_DIR
    ? resolve(environment.PI_CODING_AGENT_DIR)
    : join(homedir(), ".pi", "agent");
}

export async function ensureAgentRecipes(
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const projectDirectory = join(cwd, ".pi", "agents");
  const globalDirectory = join(agentDirectory(environment), "agents");

  await Promise.all(Object.entries(AGENT_RECIPES).map(async ([name, content]) => {
    if (await fileExists(join(projectDirectory, name))) return;
    const destination = join(globalDirectory, name);
    if (await fileExists(destination)) return;

    await mkdir(globalDirectory, { recursive: true });
    try {
      await writeFile(destination, content, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if (isFileExistsError(error)) return;
      throw error;
    }
  }));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isFileNotFoundError(error)) return false;
    throw error;
  }
}

function isFileExistsError(error: unknown): boolean {
  return errorCode(error) === "EEXIST";
}

function isFileNotFoundError(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;
}
