/**
 * TopologyProvider interface for abstracting agent role handling.
 *
 * This allows Adjutant to work with different agent topologies:
 * - Gas Town: mayor, deacon, witness, refinery, crew, polecat
 * - Standalone: user, agent
 * - Custom: any user-defined roles
 */

import type { AgentType } from "../../types/index.js";

/**
 * Agent address information.
 */
export interface AgentAddress {
  /** Full address string (e.g., "mayor/", "adjutant/polecats/flint") */
  address: string;
  /** Role/type of the agent */
  role: AgentType;
  /** Rig name if applicable */
  rig: string | null;
  /** Agent name within the role */
  name: string | null;
}

/**
 * Session name information for terminal/tmux sessions.
 */
export interface SessionInfo {
  /** Session name (e.g., "hq-mayor", "adj-witness") */
  name: string;
  /** Whether this session should be considered infrastructure */
  isInfrastructure: boolean;
}

/**
 * Abstract interface for agent topology handling.
 *
 * Implementations:
 * - GasTownTopology: Full Gas Town role hierarchy
 * - StandaloneTopology: Simple user/agent model
 */
export interface TopologyProvider {
  /** Name of this topology (e.g., "gastown", "standalone") */
  readonly name: string;

  /**
   * List all known agent types for this topology.
   */
  agentTypes(): AgentType[];

  /**
   * Get the "coordinator" agent type.
   * - Gas Town: mayor
   * - Standalone: user
   */
  coordinatorType(): AgentType;

  /**
   * Get infrastructure agent types (coordinator, health check, etc.).
   * - Gas Town: [mayor, deacon]
   * - Standalone: [user]
   */
  infrastructureTypes(): AgentType[];

  /**
   * Get worker agent types.
   * - Gas Town: [crew, polecat, witness, refinery]
   * - Standalone: [agent]
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
   * @param address Full agent address (e.g., "adjutant/polecats/flint")
   * @returns Parsed address components
   */
  parseAddress(address: string): AgentAddress | null;

  /**
   * Build an agent address from components.
   *
   * @param role Agent role/type
   * @param rig Rig name (null for infrastructure agents)
   * @param name Agent name (null for rig-level or infrastructure agents)
   * @returns Full address string or null if invalid
   */
  buildAddress(role: AgentType, rig: string | null, name: string | null): string | null;

  /**
   * Get the tmux session info for an agent.
   *
   * @param role Agent role/type
   * @param rig Rig name (null for infrastructure agents)
   * @param name Agent name (null for rig-level agents)
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
