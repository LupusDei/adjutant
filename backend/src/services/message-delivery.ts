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

// This backend lifecycle's start (≈ module load). The delivery cutoff is FLOORED here so a
// restart can never replay an agent's pre-restart history. Root cause of the "dozens of old
// messages flood tmux, an hour later, at random" bug (adj-fl00d): the backend runs under
// `tsx watch`, so any backend file save restarts it; the restart WIPES the in-memory
// AdjutantState (losing each agent's disconnectedAt), and the cutoff then fell back to the
// agent's ORIGINAL spawn time — replaying every still-pending message since it was spawned,
// on every agent's reconnect. Flooring at the lifecycle start bounds delivery to messages
// missed during THIS restart's downtime, not the entire history.
const SERVICE_STARTED_AT_MS = Date.now();
// Grace window before lifecycle start: cover realistic restart/crash downtime (a tsx-watch
// restart is seconds; a crash + server-heal restart is ≤120s). Messages sent in this window
// just before the backend came up were genuinely missed and should still be delivered.
const RESTART_REPLAY_GRACE_MS = 3 * 60 * 1000;

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

    // Clamp the stale spawn-time fallback to THIS backend lifecycle's window (adj-fl00d). This
    // branch is only reached when there is no in-memory disconnectedAt — which is exactly the
    // state a restart leaves behind. Without the clamp, `since` = the agent's ancient spawn time,
    // and every reconnect replays its entire pending backlog into tmux. The disconnectedAt branch
    // above is trusted (a real offline window) and is intentionally NOT clamped.
    const lifecycleFloor = new Date(SERVICE_STARTED_AT_MS - RESTART_REPLAY_GRACE_MS);
    if (since < lifecycleFloor) since = lifecycleFloor;
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
