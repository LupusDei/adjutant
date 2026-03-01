/**
 * Topology module - Agent role handling.
 *
 * Provides agent topology for the swarm model (user, agent).
 *
 * Usage:
 *   import { getTopology } from "./topology/index.js";
 *   const topology = getTopology();
 *   const role = topology.normalizeRole("coordinator"); // "user"
 */

import type { TopologyProvider, AgentAddress, SessionInfo } from "./topology-provider.js";
import { SwarmTopology } from "./swarm-topology.js";

// Re-export types
export type { TopologyProvider, AgentAddress, SessionInfo };

// Singleton instance
let topologyInstance: TopologyProvider | null = null;

/**
 * Get the TopologyProvider singleton.
 */
export function getTopology(): TopologyProvider {
  if (topologyInstance) {
    return topologyInstance;
  }

  topologyInstance = new SwarmTopology();
  return topologyInstance;
}

/**
 * Reset the topology singleton (for testing).
 */
export function resetTopology(): void {
  topologyInstance = null;
}

// Re-export specific topology class for direct use if needed
export { SwarmTopology } from "./swarm-topology.js";
