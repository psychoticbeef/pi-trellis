import { copyFile, mkdir, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.PI_TRELLIS_SKIP_AGENT_INSTALL !== "1") {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const canonicalPackageRoot = await realpath(packageRoot);
  const agentDir = resolve(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"));
  const installedRoots = await Promise.all(
    [join(agentDir, "git"), join(agentDir, "npm")].map(canonicalPath),
  );

  if (installedRoots.some((root) => isWithin(canonicalPackageRoot, root))) {
    const sourceDir = join(packageRoot, ".pi", "agents");
    const destinationDir = join(agentDir, "agents");
    const recipes = (await readdir(sourceDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"));

    await mkdir(destinationDir, { recursive: true });
    await Promise.all(recipes.map((entry) =>
      copyFile(join(sourceDir, entry.name), join(destinationDir, entry.name))
    ));
  }
}

async function canonicalPath(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error?.code === "ENOENT") return resolve(path);
    throw error;
  }
}

function isWithin(path, root) {
  const child = relative(root, path);
  return child.length > 0 && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}
