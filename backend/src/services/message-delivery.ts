/**
 * Message Delivery Service.
 *
 * Automatically delivers pending messages to agents when they come online.
 * Listens for mcp:agent_connected events and pushes pending messages
 * into the agent's tmux pane via the session bridge.
 */

import { getEventBus } from "./event-bus.js";
import { getSessionBridge } from "./session-bridge.js";
import type { MessageStore } from "./message-store.js";
import { logInfo, logWarn } from "../utils/index.js";

/**
 * Initialize the message delivery service.
 * Subscribes to agent connection events and flushes pending messages.
 */
export function initMessageDelivery(store: MessageStore): void {
  const bus = getEventBus();

  bus.on("mcp:agent_connected", ({ agentId }) => {
    deliverPendingMessages(store, agentId).catch((err) => {
      logWarn("Failed to deliver pending messages", { agentId, error: String(err) });
    });
  });

  logInfo("Message delivery service initialized");
}

async function deliverPendingMessages(store: MessageStore, agentId: string): Promise<void> {
  const pending = store.getPendingForRecipient(agentId);
  if (pending.length === 0) return;

  logInfo("Delivering pending messages to agent", { agentId, count: pending.length });

  let bridge;
  try {
    bridge = getSessionBridge();
  } catch {
    return;
  }

  const sessions = bridge.registry.findByName(agentId);
  if (sessions.length === 0) return;

  for (const msg of pending) {
    // Try each session until one succeeds — sendInput handles status-based
    // routing (queues when working, delivers when idle, rejects when offline)
    for (const session of sessions) {
      const sent = await bridge.sendInput(session.id, msg.body);
      if (sent) {
        store.markDelivered(msg.id);
        logInfo("Delivered pending message", { messageId: msg.id, agentId });
        break;
      }
    }
  }
}
