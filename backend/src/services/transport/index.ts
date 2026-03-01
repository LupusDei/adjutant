/**
 * Transport module - Mail delivery.
 *
 * Provides the BeadsTransport for mail delivery via direct beads operations.
 *
 * Usage:
 *   import { getTransport } from "./transport/index.js";
 *   const transport = getTransport();
 *   await transport.sendMessage({ to, from, subject, body });
 */

import type { MailTransport, SendOptions, TransportResult, ListMailOptions, NotificationProvider } from "./mail-transport.js";
import { BeadsTransport } from "./beads-transport.js";

// Re-export types
export type { MailTransport, SendOptions, TransportResult, ListMailOptions, NotificationProvider };

// Singleton instance
let transportInstance: MailTransport | null = null;

/**
 * Get the MailTransport singleton.
 */
export function getTransport(): MailTransport {
  if (transportInstance) {
    return transportInstance;
  }

  transportInstance = new BeadsTransport();
  return transportInstance;
}

/**
 * Reset the transport singleton (for testing).
 */
export function resetTransport(): void {
  transportInstance = null;
}

// Re-export specific transport class for direct use if needed
export { BeadsTransport } from "./beads-transport.js";

// Re-export notification providers
export {
  TmuxNotificationProvider,
  NoOpNotificationProvider,
  ConsoleNotificationProvider,
} from "./notification-providers.js";
