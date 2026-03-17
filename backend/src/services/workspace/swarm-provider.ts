/**
 * SwarmProvider - WorkspaceProvider for swarm/multi-agent deployments.
 *
 * Assumes a single project with a local .beads/ directory.
 *
 * Use cases:
 * - Solo developer with Claude Code
 * - Multi-agent orchestration via MCP
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { readFile } from "fs/promises";
import { join, resolve, basename } from "path";
import { homedir } from "os";
import type {
  WorkspaceProvider,
  WorkspaceConfig,
  BeadsDirInfo,
} from "./workspace-provider.js";

// ============================================================================
// Internal Helpers
// ============================================================================

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

/** Minimal project shape from ~/.adjutant/projects.json */
interface RegisteredProject {
  name: string;
  path: string;
  hasBeads?: boolean;
  active?: boolean;
}

/**
 * Check if a directory has a beads database.
 * Accepts: beads.db (SQLite), dolt/ (Dolt backend), or config.yaml (minimal signal).
 */
function hasBeadsDatabase(dirPath: string): boolean {
  const beadsDir = join(dirPath, ".beads");
  return (
    existsSync(join(beadsDir, "beads.db")) ||
    existsSync(join(beadsDir, "dolt")) ||
    existsSync(join(beadsDir, "config.yaml"))
  );
}

/**
 * Load registered projects from ~/.adjutant/projects.json.
 * Returns only projects where hasBeads is true and the path exists.
 */
function loadRegisteredProjects(): RegisteredProject[] {
  const projectsFile = join(homedir(), ".adjutant", "projects.json");
  if (!existsSync(projectsFile)) return [];

  try {
    const raw = readFileSync(projectsFile, "utf8");
    const store = JSON.parse(raw) as { projects?: RegisteredProject[] };
    if (!Array.isArray(store.projects)) return [];

    return store.projects.filter(
      (p) => p.path && existsSync(p.path) && hasBeadsDatabase(p.path)
    );
  } catch {
    return [];
  }
}

// ============================================================================
// SwarmProvider Implementation
// ============================================================================

/**
 * WorkspaceProvider implementation for swarm/multi-agent deployments.
 *
 * Features:
 * - Single .beads/ directory (local to project)
 * - No power control (always "running")
 * - No sub-projects (single project)
 */
export class SwarmProvider implements WorkspaceProvider {
  readonly name = "swarm";

  private projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ?? this.detectProjectRoot();
  }

  /**
   * Detect the project root directory.
   * Priority: ADJUTANT_PROJECT_ROOT env var > cwd
   */
  private detectProjectRoot(): string {
    const envRoot = process.env["ADJUTANT_PROJECT_ROOT"];
    if (envRoot && existsSync(envRoot)) {
      return resolve(envRoot);
    }

    // Use current working directory
    return process.cwd();
  }

  resolveRoot(): string {
    return this.projectRoot;
  }

  async loadConfig(): Promise<WorkspaceConfig> {
    // Try to load adjutant.config.json
    const configPath = join(this.projectRoot, "adjutant.config.json");
    try {
      const raw = await readFile(configPath, "utf8");
      return JSON.parse(raw) as WorkspaceConfig;
    } catch {
      // Return defaults
      return {
        name: basename(this.projectRoot),
        owner: {
          name: process.env["USER"] ?? "User",
          email: "",
        },
      };
    }
  }

  async listBeadsDirs(): Promise<BeadsDirInfo[]> {
    const results: BeadsDirInfo[] = [];
    const seenPaths = new Set<string>();

    // Include the project root's .beads/ directory if it exists
    const beadsPath = resolveBeadsDir(this.projectRoot);
    if (existsSync(join(this.projectRoot, ".beads"))) {
      results.push({
        path: beadsPath,
        project: null,
        workDir: this.projectRoot,
      });
      seenPaths.add(resolve(this.projectRoot));
    }

    // Scan immediate children for sub-projects with beads databases
    const skipDirs = new Set(["node_modules", ".git"]);
    try {
      const entries = readdirSync(this.projectRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (skipDirs.has(entry.name) || entry.name.startsWith(".")) continue;

        const childDir = join(this.projectRoot, entry.name);
        if (hasBeadsDatabase(childDir)) {
          const childBeadsPath = resolveBeadsDir(childDir);
          results.push({
            path: childBeadsPath,
            project: entry.name,
            workDir: childDir,
          });
          seenPaths.add(resolve(childDir));
        }
      }
    } catch {
      // If readdir fails (permissions, etc.), just return what we have
    }

    // NOTE: We intentionally do NOT include external registered projects here.
    // listBeadsDirs() is used by buildDatabaseList("all") which queries every
    // database sequentially through a semaphore. Including all registered projects
    // (siblings like OttoDom, gt, l2rr2l) causes 48-60+ second serial timeouts.
    // External projects are resolved on-demand via resolveProjectPath() instead.

    return results;
  }

  async resolveBeadsDirFromId(
    beadId: string
  ): Promise<{ workDir: string; beadsDir: string } | null> {
    const prefix = extractBeadPrefix(beadId);
    if (!prefix) return null;

    // In swarm mode, all beads go to the local directory
    const beadsPath = resolveBeadsDir(this.projectRoot);
    if (!existsSync(join(this.projectRoot, ".beads"))) {
      return null;
    }

    return {
      workDir: this.projectRoot,
      beadsDir: beadsPath,
    };
  }

  hasPowerControl(): boolean {
    // Swarm mode is always "running"
    return false;
  }

  hasGtBinary(): boolean {
    // No gt binary in swarm mode
    return false;
  }

  async listProjectNames(): Promise<string[]> {
    const skipDirs = new Set(["node_modules", ".git"]);
    const names = new Set<string>();
    try {
      const entries = readdirSync(this.projectRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (skipDirs.has(entry.name) || entry.name.startsWith(".")) continue;

        const childDir = join(this.projectRoot, entry.name);
        if (hasBeadsDatabase(childDir)) {
          names.add(entry.name);
        }
      }
    } catch {
      // If readdir fails, continue with registered projects
    }

    // NOTE: External registered projects are resolved on-demand via
    // resolveProjectPath(), not included in bulk listing (see listBeadsDirs comment).

    return [...names];
  }

  resolveProjectPath(projectName: string): string | null {
    // Check child directory first
    const projectPath = join(this.projectRoot, projectName);
    if (existsSync(join(projectPath, ".beads"))) {
      return projectPath;
    }

    // Check registered projects (may be outside projectRoot)
    for (const project of loadRegisteredProjects()) {
      if (project.name === projectName) {
        return project.path;
      }
    }

    return null;
  }
}

/**
 * Check if a directory looks like a swarm project (has .beads/).
 */
export function isSwarmProject(dir: string): boolean {
  return existsSync(join(dir, ".beads"));
}
