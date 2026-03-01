/**
 * TopologyProvider interface for abstracting agent role handling.
 *
 * Implementations:
 * - SwarmTopology: Simple user/agent model
 * - Custom: any user-defined roles
 */

import type { AgentType } from "../../types/index.js";

/**
 * Agent address information.
 */
export interface AgentAddress {
  /** Full address string (e.g., "adjutant/agents/flint") */
  address: string;
  /** Role/type of the agent */
  role: AgentType;
  /** Project/rig name if applicable */
  rig: string | null;
  /** Agent name within the role */
  name: string | null;
}

/**
 * Session name information for terminal/tmux sessions.
 */
export interface SessionInfo {
  /** Session name (e.g., "adj-agent") */
  name: string;
  /** Whether this session should be considered infrastructure */
  isInfrastructure: boolean;
}

/**
 * Abstract interface for agent topology handling.
 *
 * Implementations:
 * - SwarmTopology: Simple user/agent model
 */
export interface TopologyProvider {
  /** Name of this topology (e.g., "swarm") */
  readonly name: string;

  /**
   * List all known agent types for this topology.
   */
  agentTypes(): AgentType[];

  /**
   * Get the "coordinator" agent type (e.g., "user").
   */
  coordinatorType(): AgentType;

  /**
   * Get infrastructure agent types (coordinator, etc.).
   */
  infrastructureTypes(): AgentType[];

  /**
   * Get worker agent types (e.g., [agent]).
   */
  workerTypes(): AgentType[];

  /**
   * Normalize a raw role string to a known AgentType.
   * Handles aliases and variations.
   *
   * @param role Raw role string from various sources
   * @returns Normalized AgentType
   */
  normalizeRole(role: string): AgentType;

  /**
   * Parse an agent address into its components.
   *
   * @param address Full agent address (e.g., "adjutant/agents/flint")
   * @returns Parsed address components
   */
  parseAddress(address: string): AgentAddress | null;

  /**
   * Build an agent address from components.
   *
   * @param role Agent role/type
   * @param rig Project/rig name (null for infrastructure agents)
   * @param name Agent name (null for project-level or infrastructure agents)
   * @returns Full address string or null if invalid
   */
  buildAddress(role: AgentType, rig: string | null, name: string | null): string | null;

  /**
   * Get the tmux session info for an agent.
   *
   * @param role Agent role/type
   * @param rig Project/rig name (null for infrastructure agents)
   * @param name Agent name (null for project-level agents)
   * @returns Session info or null if not applicable
   */
  getSessionInfo(role: AgentType, rig: string | null, name: string | null): SessionInfo | null;

  /**
   * Check if an agent type is considered infrastructure.
   *
   * @param role Agent role/type
   * @returns True if infrastructure agent
   */
  isInfrastructure(role: AgentType): boolean;

  /**
   * Get the display name for an agent type.
   *
   * @param role Agent role/type
   * @returns Human-readable display name
   */
  getDisplayName(role: AgentType): string;
}
