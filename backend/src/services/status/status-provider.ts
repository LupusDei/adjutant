/**
 * StatusProvider interface for abstracting system status retrieval.
 *
 * Implementations:
 * - GasTownStatusProvider: Full Gas Town infrastructure status
 * - SwarmStatusProvider: Simple swarm mode status
 */

import type { PowerState, AgentStatus, RigStatus, CrewMember } from "../../types/index.js";

// ============================================================================
// Generalized Status Types
// ============================================================================

/**
 * Power control capabilities.
 * Indicates what power operations the system supports.
 */
export interface PowerCapabilities {
  /** Whether the system can be started/stopped */
  canControl: boolean;
  /** Whether the system auto-starts (no manual control needed) */
  autoStart: boolean;
}

/**
 * Workspace information.
 */
export interface WorkspaceInfo {
  /** Workspace/town name */
  name: string;
  /** Root directory path */
  root: string;
}

/**
 * Operator/user information.
 */
export interface OperatorInfo {
  /** Display name */
  name: string;
  /** Email address */
  email: string;
  /** Number of unread messages */
  unreadMail: number;
}

/**
 * Infrastructure status (coordinator agents).
 * Optional in swarm mode.
 */
export interface InfrastructureStatus {
  /** Primary coordinator (mayor in Gas Town, user in swarm) */
  coordinator: AgentStatus;
  /** Health check agent (optional) */
  healthCheck?: AgentStatus;
  /** Background daemon (optional) */
  daemon?: AgentStatus;
}

/**
 * Generalized system status.
 *
 * Replaces GastownStatus with a deployment-mode-agnostic structure.
 * Gas Town mode populates all fields; swarm mode uses a subset.
 */
export interface SystemStatus {
  /** Current power state */
  powerState: PowerState;
  /** Power control capabilities */
  powerCapabilities: PowerCapabilities;
  /** Workspace information */
  workspace: WorkspaceInfo;
  /** Operator (human user) information */
  operator: OperatorInfo;
  /** Infrastructure agent statuses (optional in swarm) */
  infrastructure?: InfrastructureStatus;
  /** Per-rig/project information (empty in swarm) */
  rigs: RigStatus[];
  /** All crew members/agents */
  agents: CrewMember[];
  /** Timestamp of this status snapshot */
  fetchedAt: string;
}

/**
 * Result type for status operations.
 */
export interface StatusResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Result data for power state transitions.
 */
export interface PowerTransitionResult {
  previousState: PowerState;
  newState: PowerState;
}

// ============================================================================
// StatusProvider Interface
// ============================================================================

/**
 * Abstract interface for system status operations.
 *
 * Implementations provide deployment-specific status retrieval and power control.
 */
export interface StatusProvider {
  /** Provider name for logging/debugging */
  readonly name: string;

  /**
   * Get the current system status.
   *
   * @returns System status or error
   */
  getStatus(): Promise<StatusResult<SystemStatus>>;

  /**
   * Get power control capabilities.
   *
   * @returns Power capabilities
   */
  getPowerCapabilities(): PowerCapabilities;

  /**
   * Check if power control is available.
   *
   * @returns True if powerUp/powerDown can be called
   */
  hasPowerControl(): boolean;

  /**
   * Start the system (power up).
   * Only available if hasPowerControl() returns true.
   *
   * @returns Transition result or error
   */
  powerUp(): Promise<StatusResult<PowerTransitionResult>>;

  /**
   * Stop the system (power down).
   * Only available if hasPowerControl() returns true.
   *
   * @returns Transition result or error
   */
  powerDown(): Promise<StatusResult<PowerTransitionResult>>;
}
