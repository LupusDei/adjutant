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

// ============================================================================
// SwarmProvider Implementation
// ============================================================================

/**
 * WorkspaceProvider implementation for swarm/multi-agent deployments.
 *
 * Features:
 * - Single .beads/ directory (local to project)
 * - No power control (always "running")
 * - No rigs (single project)
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

    // Include the project root's .beads/ directory if it exists
    const beadsPath = resolveBeadsDir(this.projectRoot);
    if (existsSync(join(this.projectRoot, ".beads"))) {
      results.push({
        path: beadsPath,
        rig: null,
        workDir: this.projectRoot,
      });
    }

    // Scan immediate children for sub-projects with .beads/beads.db
    const skipDirs = new Set(["node_modules", ".git"]);
    try {
      const entries = readdirSync(this.projectRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (skipDirs.has(entry.name) || entry.name.startsWith(".")) continue;

        const childDir = join(this.projectRoot, entry.name);
        const childBeadsDb = join(childDir, ".beads", "beads.db");
        if (existsSync(childBeadsDb)) {
          const childBeadsPath = resolveBeadsDir(childDir);
          results.push({
            path: childBeadsPath,
            rig: entry.name,
            workDir: childDir,
          });
        }
      }
    } catch {
      // If readdir fails (permissions, etc.), just return what we have
    }

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

  async listRigNames(): Promise<string[]> {
    const skipDirs = new Set(["node_modules", ".git"]);
    const names: string[] = [];
    try {
      const entries = readdirSync(this.projectRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (skipDirs.has(entry.name) || entry.name.startsWith(".")) continue;

        const childBeadsDb = join(this.projectRoot, entry.name, ".beads", "beads.db");
        if (existsSync(childBeadsDb)) {
          names.push(entry.name);
        }
      }
    } catch {
      // If readdir fails, return empty
    }
    return names;
  }

  resolveRigPath(rigName: string): string | null {
    const rigPath = join(this.projectRoot, rigName);
    if (existsSync(join(rigPath, ".beads"))) {
      return rigPath;
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
