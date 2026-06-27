/**
 * Direct message delivery (adj-202.4.1).
 *
 * The single, shared implementation of "send a DM to an agent (or the user) and
 * deliver it into the recipient's live session". It reuses the SAME collaborators
 * the rest of the system already uses — `MessageStore` for persistence, `wsBroadcast`
 * for real-time fan-out, and the session bridge for live tmux injection — so there is
 * NO second messaging implementation (Constitution Rules 4 + 9).
 *
 * Two callers share it:
 *   - the user→agent REST route (`POST /api/messages`), and
 *   - the avatar's `send_message` command tool (The Bridge), which directs agents by
 *     name as the coordinator.
 *
 * It covers the command direction (→ an agent) only: persist, broadcast, and inject
 * into the recipient's live session. The agent→user MCP path (with its APNS push)
 * keeps its own handler — a different direction with different delivery.
 */

import type { MessageStore } from "./message-store.js";
import type { EventStore } from "./event-store.js";
import { wsBroadcast } from "./ws-server.js";
import { dmConversationId } from "./conversation-store.js";
import { getSessionBridge } from "./session-bridge.js";
import { logInfo } from "../utils/logger.js";

export type DirectMessageRole = "user" | "agent";

export interface DirectMessageDeps {
  store: Pick<MessageStore, "insertMessage" | "markDelivered">;
  /** Optional timeline store; only used when {@link DirectMessageInput.emitEvent} is set. */
  eventStore?: Pick<EventStore, "insertEvent"> | undefined;
}

export interface DirectMessageInput {
  /** Sender id — e.g. "user" (the Commander) or "adjutant" (the coordinator via The Bridge). */
  from: string;
  /** Recipient: an agent name, "user", or the legacy "mayor/" alias. */
  to: string;
  body: string;
  role: DirectMessageRole;
  threadId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  /** Text injected into the recipient's live session. Defaults to `body`. */
  deliveryText?: string | undefined;
  /** Emit a `message_sent` timeline event (requires an eventStore). Default false. */
  emitEvent?: boolean | undefined;
}

export interface DirectMessageResult {
  messageId: string;
  timestamp: string;
  conversationId: string;
  /** Number of live recipient sessions the message was injected into (0 ⇒ offline/unknown). */
  deliveredToSessions: number;
}

/**
 * Persist a direct message, broadcast it, and inject it into the recipient's live
 * session(s). Never throws on the delivery leg — an uninitialized session bridge just
 * means the recipient pulls the message via MCP instead of a live nudge.
 */
export function deliverDirectMessage(deps: DirectMessageDeps, input: DirectMessageInput): DirectMessageResult {
  const { from, to, body, role } = input;

  // DM peer normalization mirrors the user/MCP paths: "mayor/" is the legacy "user" alias,
  // and dmConversationId is order-independent over the (sender, recipient) pair.
  const dmPeer = to === "mayor/" ? "user" : to;
  const conversationId = dmConversationId(from, dmPeer);

  const insertInput: Parameters<MessageStore["insertMessage"]>[0] = {
    agentId: from,
    recipient: to,
    role,
    body,
    conversationId,
  };
  if (input.threadId !== undefined) insertInput.threadId = input.threadId;
  if (input.metadata !== undefined) insertInput.metadata = input.metadata;
  const message = deps.store.insertMessage(insertInput);

  wsBroadcast({
    type: "chat_message",
    id: message.id,
    from,
    to,
    body: message.body,
    timestamp: message.createdAt,
    threadId: message.threadId ?? undefined,
    conversationId: message.conversationId ?? undefined,
    metadata: message.metadata ?? undefined,
  });

  if (input.emitEvent && deps.eventStore) {
    deps.eventStore.insertEvent({
      eventType: "message_sent",
      agentId: from,
      action: `Message to ${to}`,
      detail: { to, threadId: input.threadId },
      messageId: message.id,
    });
  }

  // Inject into the recipient agent's live session(s). sendInput handles status-based
  // routing; we mark the message delivered once an inject succeeds.
  let deliveredToSessions = 0;
  const deliveryText = input.deliveryText ?? body;
  try {
    const bridge = getSessionBridge();
    const sessions = bridge.registry.findByName(to);
    for (const session of sessions) {
      deliveredToSessions++;
      bridge
        .sendInput(session.id, deliveryText)
        .then((sent) => {
          if (sent) deps.store.markDelivered(message.id);
        })
        .catch(() => {});
    }
  } catch {
    // Session bridge not initialized — recipient will pull via MCP.
  }

  logInfo("direct message delivered", { from, to, messageId: message.id, deliveredToSessions });

  return { messageId: message.id, timestamp: message.createdAt, conversationId, deliveredToSessions };
}
