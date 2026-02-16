/**
 * Workspace Provider Index
 *
 * Auto-detects the deployment mode and provides the appropriate
 * WorkspaceProvider singleton.
 *
 * Detection priority:
 * 1. ADJUTANT_MODE env var (explicit override)
 * 2. Gas Town markers (mayor/town.json exists)
 * 3. Standalone fallback
 */

import type { WorkspaceProvider, DeploymentMode, BeadsDirInfo, WorkspaceConfig } from "./workspace-provider.js";
import { GasTownProvider, isGasTownEnvironment } from "./gastown-provider.js";
import { StandaloneProvider } from "./standalone-provider.js";

// Re-export types
export type { WorkspaceProvider, DeploymentMode, BeadsDirInfo, WorkspaceConfig };

// ============================================================================
// Singleton Management
// ============================================================================

let workspaceInstance: WorkspaceProvider | null = null;

/**
 * Get the workspace provider singleton.
 *
 * Auto-detects the deployment mode on first call and caches the result.
 * Use ADJUTANT_MODE env var to override auto-detection.
 */
export function getWorkspace(): WorkspaceProvider {
  if (workspaceInstance) {
    return workspaceInstance;
  }

  workspaceInstance = createWorkspaceProvider();
  return workspaceInstance;
}

/**
 * Reset the workspace provider singleton.
 * Useful for testing or when environment changes.
 */
export function resetWorkspace(): void {
  workspaceInstance = null;
}

/**
 * Get the current deployment mode.
 * Checks ADJUTANT_MODE env var first (set by switchMode()),
 * then falls back to the workspace provider's mode.
 */
export function getDeploymentMode(): DeploymentMode {
  const envMode = process.env["ADJUTANT_MODE"]?.toLowerCase();
  if (envMode === "gastown" || envMode === "standalone" || envMode === "swarm") {
    return envMode;
  }
  return getWorkspace().mode;
}

// ============================================================================
// Provider Factory
// ============================================================================

/**
 * Create a workspace provider based on environment detection.
 */
function createWorkspaceProvider(): WorkspaceProvider {
  const explicitMode = process.env["ADJUTANT_MODE"]?.toLowerCase();

  // Explicit mode override
  if (explicitMode === "gastown") {
    return new GasTownProvider();
  }
  if (explicitMode === "standalone") {
    return new StandaloneProvider();
  }
  if (explicitMode === "swarm") {
    // Swarm mode uses standalone provider with multi-directory support (future)
    return new StandaloneProvider();
  }

  // Auto-detection
  if (isGasTownEnvironment()) {
    return new GasTownProvider();
  }

  // Default to standalone
  return new StandaloneProvider();
}

// ============================================================================
// Convenience Functions (Backward Compatibility)
// ============================================================================

/**
 * Resolve the workspace root directory.
 * Replaces: resolveTownRoot() for Gas Town compatibility.
 */
export function resolveWorkspaceRoot(): string {
  return getWorkspace().resolveRoot();
}

/**
 * List all beads directories.
 * Replaces: listAllBeadsDirs()
 */
export async function listAllBeadsDirs(): Promise<BeadsDirInfo[]> {
  return getWorkspace().listBeadsDirs();
}

/**
 * Resolve beads directory for a bead ID.
 * Replaces: resolveBeadsDirFromId()
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

// ============================================================================
// Legacy Compatibility Layer
// ============================================================================

/**
 * @deprecated Use resolveWorkspaceRoot() instead.
 * This is kept for backward compatibility during migration.
 */
export function resolveTownRoot(): string {
  return resolveWorkspaceRoot();
}
