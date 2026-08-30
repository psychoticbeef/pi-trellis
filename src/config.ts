import { readFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";

export const DEFAULT_BOARD_ADDRESS = "http://127.0.0.1:7420";

export interface TrellisProject {
  id: string;
  root: string;
  agentsPath: string;
}

export type ReadTextFile = (path: string) => Promise<string>;

export class ProjectConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectConfigError";
  }
}

export async function findTrellisProject(
  cwd: string,
  readTextFile: ReadTextFile = (path) => readFile(path, "utf8"),
): Promise<TrellisProject> {
  let directory = cwd;

  while (true) {
    const agentsPath = join(directory, "AGENTS.md");
    try {
      const content = await readTextFile(agentsPath);
      const matches = [...content.matchAll(/^\s*trellis-project:\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*$/gm)];
      if (matches.length > 1) {
        throw new ProjectConfigError(`Mehrere trellis-project-Angaben in ${agentsPath}`);
      }
      if (matches.length === 1) {
        return { id: matches[0][1], root: directory, agentsPath };
      }
    } catch (error) {
      if (error instanceof ProjectConfigError) throw error;
      if (!isMissingFile(error)) {
        throw new ProjectConfigError(`AGENTS.md konnte nicht gelesen werden: ${errorMessage(error)}`);
      }
    }

    const parent = dirname(directory);
    if (parent === directory || directory === parse(directory).root) break;
    directory = parent;
  }

  throw new ProjectConfigError(`Keine gültige trellis-project-Angabe ab ${cwd} gefunden`);
}

export function normalizeBoardAddress(value?: string): URL {
  const raw = value?.trim() || DEFAULT_BOARD_ADDRESS;
  let address: URL;
  try {
    address = new URL(raw);
  } catch {
    throw new ProjectConfigError(`Ungültige Board-Adresse: ${raw}`);
  }
  if (address.protocol !== "http:" && address.protocol !== "https:") {
    throw new ProjectConfigError(`Ungültiges Protokoll der Board-Adresse: ${address.protocol}`);
  }
  address.username = "";
  address.password = "";
  address.search = "";
  address.hash = "";
  if (!address.pathname.endsWith("/")) address.pathname += "/";
  return address;
}

export function buildBoardUrl(projectId: string, boardAddress?: string): string {
  const address = normalizeBoardAddress(boardAddress);
  return new URL(`p/${encodeURIComponent(projectId)}/`, address).toString();
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
