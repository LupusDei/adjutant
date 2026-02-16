/**
 * GasTownProvider - WorkspaceProvider implementation for Gas Town deployments.
 *
 * This wraps the existing gastown-workspace.ts logic to implement the
 * WorkspaceProvider interface. Behavior is identical to the original.
 */

import { existsSync, readFileSync } from "fs";
import { readFile } from "fs/promises";
import { dirname, join, resolve, sep, basename } from "path";
import { execFileSync } from "child_process";
import type {
  WorkspaceProvider,
  WorkspaceConfig,
  BeadsDirInfo,
  DeploymentMode,
} from "./workspace-provider.js";

// ============================================================================
// Internal State
// ============================================================================

let cachedTownRoot: string | null = null;
let cachedGtBinary: string | null = null;

// ============================================================================
// Internal Helpers (moved from gastown-workspace.ts)
// ============================================================================

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

function resolveBeadsDir(workDir: string): string {
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

function extractBeadPrefix(beadId: string): string | null {
  const match = beadId.match(/^([a-z0-9]{2,5})-/i);
  return match?.[1]?.toLowerCase() ?? null;
}

// ============================================================================
// GasTownProvider Implementation
// ============================================================================

/**
 * WorkspaceProvider implementation for full Gas Town deployments.
 *
 * Requires:
 * - mayor/town.json to exist
 * - gt binary available (optional but expected)
 *
 * Provides:
 * - Full rig topology
 * - Power control (gt up / gt down)
 * - Multi-database beads scanning
 */
export class GasTownProvider implements WorkspaceProvider {
  readonly name = "gastown";
  readonly mode: DeploymentMode = "gastown";

  private townRoot: string;

  constructor() {
    this.townRoot = this.detectTownRoot();
  }

  /**
   * Detect and cache the town root directory.
   */
  private detectTownRoot(): string {
    if (cachedTownRoot) return cachedTownRoot;

    const home = process.env["HOME"];
    const homeGt = home ? join(home, "gt") : null;
    const homeGtIsTown = homeGt && existsSync(join(homeGt, "mayor", "town.json"));
    const homeGtExists = homeGt && existsSync(homeGt);

    // 1. Explicit environment variable
    let envRoot = process.env["GT_TOWN_ROOT"];
    if (envRoot) {
      // Expand ~ to HOME (dotenv doesn't do shell expansion)
      if (envRoot.startsWith("~/") && home) {
        envRoot = join(home, envRoot.slice(2));
      }
      if (envRoot === home && homeGtIsTown) {
        cachedTownRoot = homeGt!;
        return cachedTownRoot;
      }
      cachedTownRoot = envRoot;
      return envRoot;
    }

    // 2. Try to detect town root from CWD
    const detected = findTownRoot(process.cwd());

    if (detected === home && homeGtIsTown) {
      cachedTownRoot = homeGt!;
      return cachedTownRoot;
    }

    if (detected) {
      cachedTownRoot = detected;
      return detected;
    }

    // 3. Fallback to ~/gt if it has the proper town structure
    if (homeGtIsTown) {
      cachedTownRoot = homeGt!;
      return cachedTownRoot;
    }

    // 4. Fallback to ~/gt if it exists as a directory
    if (homeGtExists) {
      cachedTownRoot = homeGt!;
      return cachedTownRoot;
    }

    throw new Error(
      "Could not determine gastown town root. Set GT_TOWN_ROOT or run from within a town."
    );
  }

  resolveRoot(): string {
    return this.townRoot;
  }

  async loadConfig(): Promise<WorkspaceConfig> {
    const townPath = join(this.townRoot, "mayor", "town.json");
    try {
      const raw = await readFile(townPath, "utf8");
      return JSON.parse(raw) as WorkspaceConfig;
    } catch {
      return {};
    }
  }

  async listBeadsDirs(): Promise<BeadsDirInfo[]> {
    const results: BeadsDirInfo[] = [];
    const scannedBeadsPaths = new Set<string>();

    const addDir = (workDir: string, rig: string | null) => {
      const absPath = resolve(workDir);
      if (!existsSync(join(absPath, ".beads"))) return;

      const beadsPath = resolveBeadsDir(absPath);
      if (scannedBeadsPaths.has(beadsPath)) return;

      results.push({
        path: beadsPath,
        rig,
        workDir: absPath,
      });
      scannedBeadsPaths.add(beadsPath);
    };

    // 1. Town root
    addDir(this.townRoot, null);

    // 1b. Common location: ~/gt
    const homeGt = join(process.env["HOME"] || "", "gt");
    if (homeGt) {
      addDir(homeGt, null);
    }

    // 2. Configured rigs
    const rigNames = await this.listRigNames();
    for (const rigName of rigNames) {
      addDir(join(this.townRoot, rigName), rigName);
    }

    // 3. Extra rigs from env
    const extraRigs = process.env["GT_EXTRA_RIGS"];
    if (extraRigs) {
      const paths = extraRigs.split(",").map((p) => p.trim()).filter(Boolean);
      for (const p of paths) {
        const rigPath = resolve(process.cwd(), p);
        addDir(rigPath, basename(rigPath));
      }
    }

    // 4. Heuristic search up from CWD
    let current = process.cwd();
    while (true) {
      const resolvedPath = resolveBeadsDir(resolve(current));
      addDir(current, scannedBeadsPaths.has(resolvedPath) ? null : basename(current));
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }

    return results;
  }

  async resolveBeadsDirFromId(
    beadId: string
  ): Promise<{ workDir: string; beadsDir: string } | null> {
    const prefix = extractBeadPrefix(beadId);
    if (!prefix) return null;

    // Build dynamic prefix map from discovered beads dirs
    const beadsDirs = await this.listBeadsDirs();
    const prefixMap = new Map<string, { workDir: string; beadsDir: string }>();

    // Town beads use "hq" prefix
    const townDir = beadsDirs.find((d) => d.rig === null);
    if (townDir) {
      prefixMap.set("hq", { workDir: townDir.workDir, beadsDir: townDir.path });
    }

    // Read prefix from each rig's config (first match wins —
    // configured rigs take priority over heuristic discoveries)
    for (const dirInfo of beadsDirs) {
      if (!dirInfo.rig) continue;
      const rigPrefix = this.readPrefixFromConfig(dirInfo.path);
      if (rigPrefix && !prefixMap.has(rigPrefix)) {
        prefixMap.set(rigPrefix, { workDir: dirInfo.workDir, beadsDir: dirInfo.path });
      }
    }

    return prefixMap.get(prefix) ?? null;
  }

  /**
   * Read the issue prefix from a beads config file.
   */
  private readPrefixFromConfig(beadsDir: string): string | null {
    try {
      const configPath = join(beadsDir, "config.yaml");
      const content = readFileSync(configPath, "utf8");
      const prefixMatch = content.match(/^(?:prefix|issue-prefix):\s*["']?([a-zA-Z0-9_-]+)["']?\s*$/m);
      return prefixMatch?.[1] ?? null;
    } catch {
      return null;
    }
  }

  hasPowerControl(): boolean {
    return true;
  }

  hasGtBinary(): boolean {
    return this.resolveGtBinaryPath() !== null;
  }

  /**
   * Resolve the gt binary path.
   */
  resolveGtBinaryPath(): string | null {
    if (cachedGtBinary !== null) return cachedGtBinary;

    // 1. Explicit env var
    if (process.env["GT_BIN"]) {
      cachedGtBinary = process.env["GT_BIN"];
      return cachedGtBinary;
    }
    if (process.env["GT_PATH"]) {
      cachedGtBinary = process.env["GT_PATH"];
      return cachedGtBinary;
    }

    // 2. Try to find gt in PATH
    try {
      const whichCmd = process.platform === "win32" ? "where" : "which";
      const resolved = execFileSync(whichCmd, ["gt"], {
        encoding: "utf8",
        timeout: 5000,
      }).trim();
      if (resolved) {
        const firstLine = resolved.split("\n")[0];
        if (firstLine) {
          cachedGtBinary = firstLine.trim();
          return cachedGtBinary;
        }
      }
    } catch {
      // Continue to fallbacks
    }

    // 3. Try $HOME/go/bin/gt
    if (process.env["HOME"]) {
      const goPath = join(process.env["HOME"], "go", "bin", "gt");
      if (existsSync(goPath)) {
        cachedGtBinary = goPath;
        return cachedGtBinary;
      }
    }

    // Not found
    return null;
  }

  async listRigNames(): Promise<string[]> {
    const rigsPath = join(this.townRoot, "mayor", "rigs.json");
    try {
      const raw = await readFile(rigsPath, "utf8");
      const config = JSON.parse(raw) as { rigs?: Record<string, unknown> };
      return Object.keys(config.rigs ?? {});
    } catch {
      return [];
    }
  }

  resolveRigPath(rigName: string): string | null {
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

    // Fall back to rig as subdirectory of townRoot
    const rigPath = join(this.townRoot, rigName);
    if (existsSync(rigPath)) {
      return rigPath;
    }

    return null;
  }
}

/**
 * Check if the current environment is actively in Gas Town mode.
 *
 * Returns true only if:
 * - ADJUTANT_MODE=gastown is explicitly set, OR
 * - The project root itself has mayor/town.json (i.e. we're inside a town)
 *
 * The presence of GT_TOWN_ROOT alone means Gas Town is *available*,
 * not that we're currently *in* Gas Town mode.
 */
export function isGasTownEnvironment(): boolean {
  // Explicit mode override
  if (process.env["ADJUTANT_MODE"] === "gastown") {
    return true;
  }

  // Check if the project root itself is a Gas Town
  const projectRoot = process.env["ADJUTANT_PROJECT_ROOT"] || process.cwd();
  if (existsSync(join(projectRoot, "mayor", "town.json"))) {
    return true;
  }

  return false;
}

/**
 * Check if Gas Town is available for switching (but not necessarily active).
 *
 * Returns true if GT_TOWN_ROOT points to a valid town, or if we can
 * detect a town at ~/gt or the project root.
 */
export function isGasTownAvailable(): boolean {
  // Check GT_TOWN_ROOT env var
  const gtRoot = process.env["GT_TOWN_ROOT"];
  if (gtRoot && existsSync(join(gtRoot, "mayor", "town.json"))) {
    return true;
  }

  // Check if project root is a town
  const projectRoot = process.env["ADJUTANT_PROJECT_ROOT"] || process.cwd();
  if (existsSync(join(projectRoot, "mayor", "town.json"))) {
    return true;
  }

  // Check ~/gt
  const home = process.env["HOME"];
  const homeGt = home ? join(home, "gt") : null;
  if (homeGt && existsSync(join(homeGt, "mayor", "town.json"))) {
    return true;
  }

  return false;
}
