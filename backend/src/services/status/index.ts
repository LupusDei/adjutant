/**
 * Status module - System status retrieval.
 *
 * Provides the SwarmStatusProvider for system status.
 *
 * Usage:
 *   import { getStatusProvider } from "./status/index.js";
 *   const provider = getStatusProvider();
 *   const status = await provider.getStatus();
 */

import type {
  StatusProvider,
  StatusResult,
  SystemStatus,
  PowerCapabilities,
  PowerTransitionResult,
  PowerState,
} from "./status-provider.js";
import { SwarmStatusProvider } from "./swarm-status-provider.js";

// Re-export types
export type {
  StatusProvider,
  StatusResult,
  SystemStatus,
  PowerCapabilities,
  PowerTransitionResult,
  PowerState,
};
export type { WorkspaceInfo, OperatorInfo, InfrastructureStatus } from "./status-provider.js";

// Singleton instance
let statusProviderInstance: StatusProvider | null = null;

/**
 * Get the StatusProvider singleton.
 */
export function getStatusProvider(): StatusProvider {
  if (statusProviderInstance) {
    return statusProviderInstance;
  }

  statusProviderInstance = new SwarmStatusProvider();
  return statusProviderInstance;
}

/**
 * Reset the status provider singleton (for testing).
 */
export function resetStatusProvider(): void {
  statusProviderInstance = null;
}

// Re-export specific provider class for direct use if needed
export { SwarmStatusProvider } from "./swarm-status-provider.js";
