import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { dirname, join, resolve, sep } from "path";

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

  const envRoot = process.env["GT_TOWN_ROOT"];
  if (envRoot) {
    cachedTownRoot = envRoot;
    return envRoot;
  }

  const detected = findTownRoot(process.cwd());
  if (!detected) {
    throw new Error(
      "Could not determine gastown town root. Set GT_TOWN_ROOT or run from within a town."
    );
  }

  cachedTownRoot = detected;
  return detected;
}

export async function loadTownConfig(townRoot: string): Promise<TownConfig> {
  const townPath = join(townRoot, "mayor", "town.json");
  try {
    const raw = await readFile(townPath, "utf8");
    return JSON.parse(raw) as TownConfig;
  } catch {
    return { name: undefined };
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
