/**
 * StandaloneProvider - WorkspaceProvider for single-project deployments.
 *
 * This provider is for running Adjutant without Gas Town infrastructure.
 * It assumes a single project with a local .beads/ directory.
 *
 * Use cases:
 * - Solo developer with Claude Code
 * - Single project without multi-agent orchestration
 * - Testing/development without Gas Town
 */

import { existsSync, readFileSync } from "fs";
import { readFile } from "fs/promises";
import { join, resolve, basename } from "path";
import type {
  WorkspaceProvider,
  WorkspaceConfig,
  BeadsDirInfo,
  DeploymentMode,
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
  const match = beadId.match(/^([a-z]{2,3})-/i);
  return match?.[1]?.toLowerCase() ?? null;
}

// ============================================================================
// StandaloneProvider Implementation
// ============================================================================

/**
 * WorkspaceProvider implementation for standalone/single-project deployments.
 *
 * Features:
 * - Single .beads/ directory (local to project)
 * - No power control (always "running")
 * - No gt binary required
 * - No rigs (single project)
 */
export class StandaloneProvider implements WorkspaceProvider {
  readonly name = "standalone";
  readonly mode: DeploymentMode = "standalone";

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

    // Only include the local .beads/ directory if it exists
    const beadsPath = resolveBeadsDir(this.projectRoot);
    if (existsSync(join(this.projectRoot, ".beads"))) {
      results.push({
        path: beadsPath,
        rig: null,
        workDir: this.projectRoot,
      });
    }

    return results;
  }

  async resolveBeadsDirFromId(
    beadId: string
  ): Promise<{ workDir: string; beadsDir: string } | null> {
    const prefix = extractBeadPrefix(beadId);
    if (!prefix) return null;

    // In standalone mode, all beads go to the local directory
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
    // Standalone mode is always "running"
    return false;
  }

  hasGtBinary(): boolean {
    // No gt binary in standalone mode
    return false;
  }

  async listRigNames(): Promise<string[]> {
    // No rigs in standalone mode
    return [];
  }

  resolveRigPath(_rigName: string): string | null {
    // No rigs in standalone mode
    return null;
  }
}

/**
 * Check if a directory looks like a standalone project (has .beads/ but no mayor/).
 */
export function isStandaloneProject(dir: string): boolean {
  const hasBeads = existsSync(join(dir, ".beads"));
  const hasMayor = existsSync(join(dir, "mayor"));
  return hasBeads && !hasMayor;
}
