/**
 * Workspace Provider Index
 *
 * Provides the SwarmProvider singleton for workspace resolution.
 */

import type { WorkspaceProvider, BeadsDirInfo, WorkspaceConfig } from "./workspace-provider.js";
import { SwarmProvider } from "./swarm-provider.js";

// Re-export types
export type { WorkspaceProvider, BeadsDirInfo, WorkspaceConfig };

// ============================================================================
// Singleton Management
// ============================================================================

let workspaceInstance: WorkspaceProvider | null = null;

/**
 * Get the workspace provider singleton.
 */
export function getWorkspace(): WorkspaceProvider {
  if (workspaceInstance) {
    return workspaceInstance;
  }

  workspaceInstance = new SwarmProvider();
  return workspaceInstance;
}

/**
 * Reset the workspace provider singleton.
 * Useful for testing or when environment changes.
 */
export function resetWorkspace(): void {
  workspaceInstance = null;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Resolve the workspace root directory.
 */
export function resolveWorkspaceRoot(): string {
  return getWorkspace().resolveRoot();
}

/**
 * List all beads directories.
 */
export async function listAllBeadsDirs(): Promise<BeadsDirInfo[]> {
  return getWorkspace().listBeadsDirs();
}

/**
 * Resolve beads directory for a bead ID.
 */
export async function resolveBeadsDirFromId(
  beadId: string
): Promise<{ workDir: string; beadsDir: string } | null> {
  return getWorkspace().resolveBeadsDirFromId(beadId);
}

/**
 * Check if power control is available.
 */
export function hasPowerControl(): boolean {
  return getWorkspace().hasPowerControl();
}

/**
 * Check if the gt binary is available.
 */
export function hasGtBinary(): boolean {
  return getWorkspace().hasGtBinary();
}

/**
 * List available rig names.
 */
export async function listRigNames(): Promise<string[]> {
  return getWorkspace().listRigNames();
}

/**
 * Resolve path for a rig.
 */
export function resolveRigPath(rigName: string): string | null {
  return getWorkspace().resolveRigPath(rigName);
}

/**
 * Load workspace configuration.
 */
export async function loadWorkspaceConfig(): Promise<WorkspaceConfig> {
  return getWorkspace().loadConfig();
}
