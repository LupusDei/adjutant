import { existsSync, readFileSync } from "fs";
import { readFile } from "fs/promises";
import { dirname, join, resolve, sep, basename } from "path";
import { execFileSync } from "child_process";

export interface TownConfig {
  name?: string;
  owner?: {
    name?: string;
    email?: string;
    username?: string;
  };
}

export interface RigsConfig {
  rigs?: Record<string, unknown>;
}

export interface BeadsDirInfo {
  path: string;
  rig: string | null;
  workDir: string;
}

let cachedTownRoot: string | null = null;

function isInWorktreePath(pathValue: string): boolean {
  return pathValue.includes(`${sep}polecats${sep}`) || pathValue.includes(`${sep}crew${sep}`);
}

function findTownRoot(startDir: string): string | null {
  const absDir = resolve(startDir);
  const inWorktree = isInWorktreePath(absDir);
  let primaryMatch: string | null = null;
  let secondaryMatch: string | null = null;

  let current = absDir;
  for (;;) {
    const primaryMarker = join(current, "mayor", "town.json");
    if (existsSync(primaryMarker)) {
      if (!inWorktree) return current;
      primaryMatch = current;
    }

    if (!secondaryMatch) {
      const secondaryMarker = join(current, "mayor");
      if (existsSync(secondaryMarker)) {
        secondaryMatch = current;
      }
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return primaryMatch ?? secondaryMatch;
}

export function resolveTownRoot(): string {
  if (cachedTownRoot) return cachedTownRoot;

  const home = process.env["HOME"];
  const homeGt = home ? join(home, "gt") : null;
  const homeGtIsTown = homeGt && existsSync(join(homeGt, "mayor", "town.json"));

  // 1. Explicit environment variable
  const envRoot = process.env["GT_TOWN_ROOT"];
  if (envRoot) {
    // If GT_TOWN_ROOT is just HOME, and ~/gt exists, prefer ~/gt
    if (envRoot === home && homeGtIsTown) {
      cachedTownRoot = homeGt!;
      return cachedTownRoot;
    }
    cachedTownRoot = envRoot;
    return envRoot;
  }

  // 2. Try to detect town root from CWD
  const detected = findTownRoot(process.cwd());

  // If detected is just HOME, but ~/gt exists, prefer ~/gt
  if (detected === home && homeGtIsTown) {
    cachedTownRoot = homeGt!;
    return cachedTownRoot;
  }

  if (detected) {
    cachedTownRoot = detected;
    return detected;
  }

  // 3. Fallback to ~/gt if it exists
  if (homeGtIsTown) {
    cachedTownRoot = homeGt!;
    return cachedTownRoot;
  }

  throw new Error(
    "Could not determine gastown town root. Set GT_TOWN_ROOT or run from within a town."
  );
}

/**
 * Resolves the gastown binary path.
 * Priority: GT_BIN env var > GT_PATH env var > `which gt` > $HOME/go/bin/gt > 'gt' (PATH lookup)
 */
export function resolveGtBinary(): string {
  // 1. Explicit env var takes precedence
  if (process.env["GT_BIN"]) {
    return process.env["GT_BIN"];
  }
  if (process.env["GT_PATH"]) {
    return process.env["GT_PATH"];
  }

  // 2. Try to find gt in PATH using 'which' (Unix) or 'where' (Windows)
  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const resolved = execFileSync(whichCmd, ["gt"], {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    if (resolved) {
      // 'where' on Windows may return multiple lines; take the first
      const firstLine = resolved.split("\n")[0];
      if (firstLine) {
        return firstLine.trim();
      }
    }
  } catch {
    // which/where failed, continue to fallbacks
  }

  // 3. Try $HOME/go/bin/gt (common Go install location) - only if it exists
  if (process.env["HOME"]) {
    const goPath = join(process.env["HOME"], "go", "bin", "gt");
    if (existsSync(goPath)) {
      return goPath;
    }
  }

  // 4. Last resort: let spawn try PATH resolution
  return "gt";
}

export async function loadTownConfig(townRoot: string): Promise<TownConfig> {
  const townPath = join(townRoot, "mayor", "town.json");
  try {
    const raw = await readFile(townPath, "utf8");
    return JSON.parse(raw) as TownConfig;
  } catch {
    return {};
  }
}

export async function loadRigsConfig(townRoot: string): Promise<RigsConfig> {
  const rigsPath = join(townRoot, "mayor", "rigs.json");
  try {
    const raw = await readFile(rigsPath, "utf8");
    return JSON.parse(raw) as RigsConfig;
  } catch {
    return { rigs: {} };
  }
}

export async function listRigNames(townRoot: string): Promise<string[]> {
  const rigsConfig = await loadRigsConfig(townRoot);
  return Object.keys(rigsConfig.rigs ?? {});
}

/**
 * Known external rig paths that aren't subdirectories of townRoot.
 * Can be extended via GT_RIG_PATHS env var (format: "rigName=/path,rigName2=/path2")
 */
const EXTERNAL_RIG_PATHS: Record<string, string> = {
  gastown_boy: "/Users/will/Projects/Saults/gastown-boy",
};

/**
 * Maps bead prefixes to rig names.
 * Used to route bead lookups to the correct beads database.
 */
const BEAD_PREFIX_TO_RIG: Record<string, string | null> = {
  hq: null, // Town-level beads
  gt: "gastown",
  gb: "gastown_boy",
};

/**
 * Resolves the filesystem path for a rig.
 * Checks external paths first, then falls back to townRoot/rigName.
 */
export function resolveRigPath(rigName: string, townRoot: string): string | null {
  // Check external rig paths from env
  const envPaths = process.env["GT_RIG_PATHS"];
  if (envPaths) {
    for (const pair of envPaths.split(",")) {
      const [name, path] = pair.split("=").map((s) => s.trim());
      if (name === rigName && path && existsSync(path)) {
        return path;
      }
    }
  }

  // Check known external paths
  const externalPath = EXTERNAL_RIG_PATHS[rigName];
  if (externalPath && existsSync(externalPath)) {
    return externalPath;
  }

  // Fall back to rig as subdirectory of townRoot
  const rigPath = join(townRoot, rigName);
  if (existsSync(rigPath)) {
    return rigPath;
  }

  return null;
}

/**
 * Extracts the prefix from a bead ID.
 * E.g., "hq-abc123" → "hq", "gb-xyz" → "gb"
 */
export function extractBeadPrefix(beadId: string): string | null {
  const match = beadId.match(/^([a-z]{2,3})-/i);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Resolves the beads directory for a bead ID based on its prefix.
 * Returns { workDir, beadsDir } for use with execBd.
 */
export function resolveBeadsDirFromId(
  beadId: string,
  townRoot: string
): { workDir: string; beadsDir: string } | null {
  const prefix = extractBeadPrefix(beadId);
  if (!prefix) return null;

  const rigName = BEAD_PREFIX_TO_RIG[prefix];

  // Town-level beads (hq-*)
  if (rigName === null || rigName === undefined) {
    if (prefix === "hq") {
      return {
        workDir: townRoot,
        beadsDir: resolveBeadsDir(townRoot),
      };
    }
    // Unknown prefix - default to town level
    return {
      workDir: townRoot,
      beadsDir: resolveBeadsDir(townRoot),
    };
  }

  // Rig-specific beads
  const rigPath = resolveRigPath(rigName, townRoot);
  if (!rigPath) return null;

  return {
    workDir: rigPath,
    beadsDir: resolveBeadsDir(rigPath),
  };
}

/**
 * Returns a beads directory path for a given workspace directory,
 * following redirects if present.
 */
export function resolveBeadsDir(workDir: string): string {
  const beadsDir = join(workDir, ".beads");
  const redirectPath = join(beadsDir, "redirect");
  if (!existsSync(redirectPath)) return beadsDir;
  
  try {
    const target = readFileSync(redirectPath, "utf8").trim();
    if (!target) return beadsDir;
    return resolve(workDir, target);
  } catch {
    return beadsDir;
  }
}

export async function listAllBeadsDirs(): Promise<BeadsDirInfo[]> {
  const townRoot = resolveTownRoot();
  const results: BeadsDirInfo[] = [];
  const scannedPaths = new Set<string>();

  const addDir = (workDir: string, rig: string | null) => {
    const absPath = resolve(workDir);
    if (scannedPaths.has(absPath)) return;
    if (existsSync(join(absPath, ".beads"))) {
      results.push({
        path: resolveBeadsDir(absPath),
        rig,
        workDir: absPath
      });
      scannedPaths.add(absPath);
    }
  };

  // 1. Town root
  addDir(townRoot, null);

  // 1b. Common location: ~/gt
  const homeGt = join(process.env["HOME"] || "", "gt");
  if (homeGt) {
    addDir(homeGt, null);
  }

  // 2. Configured rigs
  const rigNames = await listRigNames(townRoot);
  for (const rigName of rigNames) {
    addDir(join(townRoot, rigName), rigName);
  }

  // 3. Extra rigs from env
  const extraRigs = process.env["GT_EXTRA_RIGS"];
  if (extraRigs) {
    const paths = extraRigs.split(",").map(p => p.trim()).filter(Boolean);
    for (const p of paths) {
      const rigPath = resolve(process.cwd(), p);
      addDir(rigPath, basename(rigPath));
    }
  }

  // 4. Heuristic search up from CWD
  let current = process.cwd();
  while (true) {
    addDir(current, scannedPaths.has(resolve(current)) ? null : basename(current));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return results;
}
