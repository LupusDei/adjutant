/**
 * WorkspaceProvider interface for abstracting workspace resolution.
 *
 * This allows Adjutant to work with different deployment modes:
 * - Gas Town: Full multi-agent orchestration with mayor, rigs, etc.
 * - Standalone: Single project with local .beads/ directory
 * - Swarm: Multiple agents without Gas Town infrastructure
 */

/**
 * Information about a beads directory.
 */
export interface BeadsDirInfo {
  /** Absolute path to the .beads directory */
  path: string;
  /** Rig name if this is a rig-specific beads dir, null for town-level */
  rig: string | null;
  /** Working directory containing this beads directory */
  workDir: string;
}

/**
 * Workspace configuration loaded from config files.
 */
export interface WorkspaceConfig {
  /** Workspace/project name */
  name?: string;
  /** Owner information */
  owner?: {
    name?: string;
    email?: string;
    username?: string;
  };
}

/**
 * Deployment mode for this workspace.
 */
export type DeploymentMode = "gastown" | "standalone" | "swarm";

/**
 * Abstract interface for workspace resolution.
 *
 * Implementations:
 * - GasTownProvider: Full Gas Town deployment with mayor/town.json
 * - StandaloneProvider: Single project with local .beads/
 */
export interface WorkspaceProvider {
  /** Name of this provider (e.g., "gastown", "standalone") */
  readonly name: string;

  /** Deployment mode */
  readonly mode: DeploymentMode;

  /**
   * Root directory for this workspace.
   * - Gas Town: Town root (directory containing mayor/)
   * - Standalone: Project root (cwd or configured path)
   */
  resolveRoot(): string;

  /**
   * Load workspace configuration.
   * - Gas Town: Reads mayor/town.json
   * - Standalone: Reads adjutant.config.json or returns defaults
   */
  loadConfig(): Promise<WorkspaceConfig>;

  /**
   * List all beads directories to scan.
   * - Gas Town: Town .beads/ + all rig .beads/ directories
   * - Standalone: Just the local .beads/ directory
   */
  listBeadsDirs(): Promise<BeadsDirInfo[]>;

  /**
   * Resolve beads directory for a specific bead ID based on its prefix.
   * @param beadId Full bead ID (e.g., "hq-abc123", "adj-xyz")
   * @returns Directory info or null if not found
   */
  resolveBeadsDirFromId(beadId: string): Promise<{ workDir: string; beadsDir: string } | null>;

  /**
   * Whether this workspace has centralized power control.
   * - Gas Town: true (gt up / gt down)
   * - Standalone: false (always "running")
   */
  hasPowerControl(): boolean;

  /**
   * Whether the gt binary is available.
   * - Gas Town: true
   * - Standalone: false
   */
  hasGtBinary(): boolean;

  /**
   * List available rig names.
   * - Gas Town: Reads from mayor/rigs.json
   * - Standalone: Empty array
   */
  listRigNames(): Promise<string[]>;

  /**
   * Resolve the filesystem path for a rig.
   * @param rigName Name of the rig
   * @returns Absolute path or null if not found
   */
  resolveRigPath(rigName: string): string | null;
}
