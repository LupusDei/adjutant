/**
 * Topology module - Agent role handling abstraction.
 *
 * Provides deployment-mode-aware topology handling:
 * - Gas Town: Full hierarchy (mayor, deacon, witness, refinery, crew, polecat)
 * - Standalone: Simple model (user, agent)
 *
 * Usage:
 *   import { getTopology } from "./topology/index.js";
 *   const topology = getTopology();
 *   const role = topology.normalizeRole("coordinator"); // "mayor" in gastown
 */

import { getWorkspace } from "../workspace/index.js";
import type { TopologyProvider, AgentAddress, SessionInfo } from "./topology-provider.js";
import { GasTownTopology } from "./gastown-topology.js";
import { StandaloneTopology } from "./standalone-topology.js";

// Re-export types
export type { TopologyProvider, AgentAddress, SessionInfo };

// Singleton instances
let topologyInstance: TopologyProvider | null = null;

/**
 * Get the appropriate TopologyProvider for the current deployment mode.
 *
 * Uses the workspace provider to determine which topology to use:
 * - gastown mode → GasTownTopology
 * - standalone/swarm mode → StandaloneTopology
 */
export function getTopology(): TopologyProvider {
  if (topologyInstance) {
    return topologyInstance;
  }

  const workspace = getWorkspace();

  switch (workspace.mode) {
    case "gastown":
      topologyInstance = new GasTownTopology();
      break;
    case "standalone":
    case "swarm":
    default:
      topologyInstance = new StandaloneTopology();
      break;
  }

  return topologyInstance;
}

/**
 * Reset the topology singleton (for testing).
 */
export function resetTopology(): void {
  topologyInstance = null;
}

// Re-export specific topology classes for direct use if needed
export { GasTownTopology } from "./gastown-topology.js";
export { StandaloneTopology } from "./standalone-topology.js";
