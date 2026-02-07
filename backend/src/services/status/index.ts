/**
 * Status module - System status and power control abstraction.
 *
 * Provides deployment-mode-aware status handling:
 * - Gas Town: Full infrastructure status with power control
 * - Standalone: Simple always-on status without power control
 *
 * Usage:
 *   import { getStatusProvider } from "./status/index.js";
 *   const provider = getStatusProvider();
 *   const status = await provider.getStatus();
 */

import { getWorkspace } from "../workspace/index.js";
import type {
  StatusProvider,
  StatusResult,
  SystemStatus,
  PowerCapabilities,
  PowerTransitionResult,
} from "./status-provider.js";
import { GasTownStatusProvider } from "./gastown-status-provider.js";
import { StandaloneStatusProvider } from "./standalone-status-provider.js";

// Re-export types
export type {
  StatusProvider,
  StatusResult,
  SystemStatus,
  PowerCapabilities,
  PowerTransitionResult,
};
export type { WorkspaceInfo, OperatorInfo, InfrastructureStatus } from "./status-provider.js";

// Singleton instance
let statusProviderInstance: StatusProvider | null = null;

/**
 * Get the appropriate StatusProvider for the current deployment mode.
 *
 * Uses the workspace provider to determine which status provider to use:
 * - gastown mode → GasTownStatusProvider
 * - standalone/swarm mode → StandaloneStatusProvider
 */
export function getStatusProvider(): StatusProvider {
  if (statusProviderInstance) {
    return statusProviderInstance;
  }

  const workspace = getWorkspace();

  switch (workspace.mode) {
    case "gastown":
      statusProviderInstance = new GasTownStatusProvider();
      break;
    case "standalone":
    case "swarm":
    default:
      statusProviderInstance = new StandaloneStatusProvider();
      break;
  }

  return statusProviderInstance;
}

/**
 * Reset the status provider singleton (for testing).
 */
export function resetStatusProvider(): void {
  statusProviderInstance = null;
}

// Re-export specific provider classes for direct use if needed
export { GasTownStatusProvider } from "./gastown-status-provider.js";
export { StandaloneStatusProvider } from "./standalone-status-provider.js";
