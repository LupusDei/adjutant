/**
 * Transport module - Mail delivery abstraction.
 *
 * Provides deployment-mode-aware mail transport:
 * - Gas Town: gt mail send with tmux notifications
 * - Standalone: Direct beads operations
 *
 * Usage:
 *   import { getTransport } from "./transport/index.js";
 *   const transport = getTransport();
 *   await transport.sendMessage({ to, from, subject, body });
 */

import { getWorkspace } from "../workspace/index.js";
import type { MailTransport, SendOptions, TransportResult, ListMailOptions, NotificationProvider } from "./mail-transport.js";
import { GasTownTransport } from "./gastown-transport.js";
import { BeadsTransport } from "./beads-transport.js";

// Re-export types
export type { MailTransport, SendOptions, TransportResult, ListMailOptions, NotificationProvider };

// Singleton instance
let transportInstance: MailTransport | null = null;

/**
 * Get the appropriate MailTransport for the current deployment mode.
 *
 * Uses the workspace provider to determine which transport to use:
 * - gastown mode → GasTownTransport
 * - standalone/swarm mode → BeadsTransport
 */
export function getTransport(): MailTransport {
  if (transportInstance) {
    return transportInstance;
  }

  const workspace = getWorkspace();

  switch (workspace.mode) {
    case "gastown":
      transportInstance = new GasTownTransport();
      break;
    case "standalone":
    case "swarm":
    default:
      transportInstance = new BeadsTransport();
      break;
  }

  return transportInstance;
}

/**
 * Reset the transport singleton (for testing).
 */
export function resetTransport(): void {
  transportInstance = null;
}

// Re-export specific transport classes for direct use if needed
export { GasTownTransport } from "./gastown-transport.js";
export { BeadsTransport } from "./beads-transport.js";

// Re-export notification providers
export {
  TmuxNotificationProvider,
  NoOpNotificationProvider,
  ConsoleNotificationProvider,
} from "./notification-providers.js";
