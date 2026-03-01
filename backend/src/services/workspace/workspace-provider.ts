/**
 * WorkspaceProvider interface for abstracting workspace resolution.
 */

/**
 * Information about a beads directory.
 */
export interface BeadsDirInfo {
  /** Absolute path to the .beads directory */
  path: string;
  /** Rig name if this is a rig-specific beads dir, null for project-level */
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
 * Abstract interface for workspace resolution.
 *
 * Implementations:
 * - SwarmProvider: Swarm/multi-agent deployment with local .beads/
 */
export interface WorkspaceProvider {
  /** Name of this provider (e.g., "swarm") */
  readonly name: string;

  /**
   * Root directory for this workspace.
   */
  resolveRoot(): string;

  /**
   * Load workspace configuration.
   */
  loadConfig(): Promise<WorkspaceConfig>;

  /**
   * List all beads directories to scan.
   */
  listBeadsDirs(): Promise<BeadsDirInfo[]>;

  /**
   * Resolve beads directory for a specific bead ID based on its prefix.
   * @param beadId Full bead ID (e.g., "adj-xyz")
   * @returns Directory info or null if not found
   */
  resolveBeadsDirFromId(beadId: string): Promise<{ workDir: string; beadsDir: string } | null>;

  /**
   * Whether this workspace has centralized power control.
   */
  hasPowerControl(): boolean;

  /**
   * Whether the gt binary is available.
   */
  hasGtBinary(): boolean;

  /**
   * List available rig names.
   */
  listRigNames(): Promise<string[]>;

  /**
   * Resolve the filesystem path for a rig.
   * @param rigName Name of the rig
   * @returns Absolute path or null if not found
   */
  resolveRigPath(rigName: string): string | null;
}
