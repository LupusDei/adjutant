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
import type { AdjutantState } from "./adjutant/state-store.js";
import { logInfo, logWarn } from "../utils/index.js";

/**
 * Initialize the message delivery service.
 * Subscribes to agent connection events and flushes pending messages.
 *
 * @param state - AdjutantState for looking up agent disconnectedAt timestamps.
 *                When provided, messages sent after the agent's last disconnect
 *                are delivered (catching messages sent during downtime). Without
 *                it, falls back to session createdAt (adj-091 behavior).
 */
export function initMessageDelivery(store: MessageStore, state?: AdjutantState): void {
  const bus = getEventBus();

  bus.on("mcp:agent_connected", ({ agentId }) => {
    // eslint-disable-next-line @typescript-eslint/use-unknown-in-catch-callback-variable
    deliverPendingMessages(store, agentId, state).catch((err) => {
      logWarn("Failed to deliver pending messages", { agentId, error: String(err) });
    });
  });

  logInfo("Message delivery service initialized");
}

async function deliverPendingMessages(
  store: MessageStore,
  agentId: string,
  state?: AdjutantState
): Promise<void> {
  let bridge;
  try {
    bridge = getSessionBridge();
  } catch {
    return;
  }

  const sessions = bridge.registry.findByName(agentId);
  if (sessions.length === 0) return;

  // Determine the cutoff time for message delivery:
  // 1. Use the agent's disconnectedAt from the profile (catches messages sent
  //    while the agent was offline — between disconnect and reconnect)
  // 2. Fall back to the earliest session's createdAt (adj-091 behavior: prevents
  //    stale messages from previous lifecycles being replayed)
  let since: Date;
  const profile = state?.getAgentProfile(agentId);
  if (profile?.disconnectedAt) {
    since = new Date(profile.disconnectedAt);
  } else {
    const earliestSession = sessions.reduce((oldest, s) =>
      s.createdAt < oldest.createdAt ? s : oldest
    );
    since = earliestSession.createdAt;
  }

  const pending = store.getPendingForRecipient(agentId, since);
  if (pending.length === 0) return;

  logInfo("Delivering pending messages to agent", { agentId, count: pending.length, since: since.toISOString() });

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
