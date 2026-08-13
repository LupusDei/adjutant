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
import { toPublicMessageAttachment } from "./attachment-store.js";
import { dmConversationId } from "./conversation-store.js";
import { getSessionBridge } from "./session-bridge.js";
import { deliverImageAttachments } from "./attachment-delivery-service.js";
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
  /** Ids of previously-uploaded (unlinked) attachments to link to this message (adj-203). */
  attachmentIds?: string[] | undefined;
}

export interface DirectMessageResult {
  messageId: string;
  timestamp: string;
  conversationId: string;
  /**
   * How many live recipient sessions the message reached. **The meaning depends on
   * which entry point produced it**, and the difference is the whole point of
   * {@link deliverDirectMessageAwaited}:
   *   - {@link deliverDirectMessage} — sessions FOUND in the registry. The injections
   *     are fire-and-forget, so a positive number means "a live session exists", not
   *     "the text arrived".
   *   - {@link deliverDirectMessageAwaited} — injections that actually resolved true.
   *     0 ⇒ nobody received it.
   */
  deliveredToSessions: number;
}

/** Everything the two entry points share: the persisted message and its envelope. */
interface PreparedDelivery {
  message: ReturnType<MessageStore["insertMessage"]>;
  conversationId: string;
  deliveryText: string;
}

/**
 * Persist, broadcast, and (optionally) emit the timeline event. Everything up to the
 * injection leg — which is the only thing the sync and awaited paths do differently.
 */
function prepareDelivery(deps: DirectMessageDeps, input: DirectMessageInput): PreparedDelivery {
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
  if (input.attachmentIds !== undefined) insertInput.attachmentIds = input.attachmentIds;
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
    // adj-203: carry linked image attachments so web + iOS render them inline in real
    // time — as the PUBLIC DTO only (adj-203.2.5.1: never leak the absolute storagePath).
    attachments:
      message.attachments !== undefined && message.attachments.length > 0
        ? message.attachments.map(toPublicMessageAttachment)
        : undefined,
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

  return { message, conversationId, deliveryText: input.deliveryText ?? body };
}

/**
 * Persist a direct message, broadcast it, and inject it into the recipient's live
 * session(s). Never throws on the delivery leg — an uninitialized session bridge just
 * means the recipient pulls the message via MCP instead of a live nudge.
 *
 * The injection is deliberately fire-and-forget: both callers answer an HTTP request or
 * a tool call and must not block on tmux I/O. The cost is that `deliveredToSessions`
 * counts sessions FOUND. Callers that must report arrival honestly want
 * {@link deliverDirectMessageAwaited}.
 */
export function deliverDirectMessage(deps: DirectMessageDeps, input: DirectMessageInput): DirectMessageResult {
  const { from, to } = input;
  const { message, conversationId, deliveryText } = prepareDelivery(deps, input);

  let deliveredToSessions = 0;
  // adj-203 US2: a message carrying image attachments delivers a richer screenshot
  // prompt (absolute paths + body) via the attachment delivery service instead of the
  // plain body, so the agent's Claude can Read the image. Both legs are fire-and-forget
  // and best-effort — tmux latency/failure never blocks or fails the send response.
  const imageAttachments = (message.attachments ?? []).filter((a) => a.kind === "image");
  try {
    const bridge = getSessionBridge();
    if (imageAttachments.length > 0) {
      // Count online sessions synchronously for the envelope; the injection itself is
      // a non-awaited tail so the send response is not blocked on tmux I/O.
      deliveredToSessions = bridge.registry
        .findByName(to)
        .filter((s) => s.status !== "offline").length;
      void deliverImageAttachments(
        { registry: bridge.registry, inputRouter: bridge.inputRouter },
        { message, recipient: to },
      )
        .then((r) => {
          if (r.sessionsDelivered > 0) deps.store.markDelivered(message.id);
        })
        .catch(() => {});
    } else {
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
    }
  } catch {
    // Session bridge not initialized — recipient will pull via MCP.
  }

  logInfo("direct message delivered", { from, to, messageId: message.id, deliveredToSessions });

  return { messageId: message.id, timestamp: message.createdAt, conversationId, deliveredToSessions };
}

/**
 * As {@link deliverDirectMessage}, but the injection leg is AWAITED and the returned
 * `deliveredToSessions` counts only the sends that actually resolved true. A 0 means
 * nobody received it.
 *
 * WHY A SIBLING FUNCTION rather than an `awaitDelivery` option on the existing export
 * (syl-j8fa.1): an option that flips the return between `T` and `Promise<T>` needs
 * overloads to type honestly, and every existing call site then reads as "might be a
 * promise" at a glance even though it never is. The two behaviours also differ in what
 * the number MEANS, not merely in when it is available — "a live session exists" versus
 * "the text was injected" — and a boolean flag hides that behind a truthy argument at
 * the call site. A separate name makes the caller state which guarantee it is asking
 * for, and leaves `deliverDirectMessage` byte-for-byte the contract its two existing
 * callers already depend on. The shared persist/broadcast/event core lives in
 * `prepareDelivery`, so there is still exactly one implementation of the message half.
 *
 * Use this wherever the count is REPORTED BACK to a caller who will act on it — the
 * `direct_message` MCP tool is the motivating case: a model that is told "sent" when
 * nothing arrived will narrate a delivery that never happened.
 *
 * Still never throws on the delivery leg: an uninitialized bridge, a dead pane, or a
 * rejecting `sendInput` all come back as 0 with the message persisted and broadcast.
 */
export async function deliverDirectMessageAwaited(
  deps: DirectMessageDeps,
  input: DirectMessageInput,
): Promise<DirectMessageResult> {
  const { from, to } = input;
  const { message, conversationId, deliveryText } = prepareDelivery(deps, input);

  let deliveredToSessions = 0;
  const imageAttachments = (message.attachments ?? []).filter((a) => a.kind === "image");
  try {
    const bridge = getSessionBridge();
    if (imageAttachments.length > 0) {
      // adj-203 US2: image-bearing messages inject a richer screenshot prompt. Await it
      // so the count is the service's real sessionsDelivered, not the online-session
      // headcount the fire-and-forget path uses.
      const result = await deliverImageAttachments(
        { registry: bridge.registry, inputRouter: bridge.inputRouter },
        { message, recipient: to },
      );
      deliveredToSessions = result.sessionsDelivered;
    } else {
      const sessions = bridge.registry.findByName(to);
      // allSettled, not all: one dead pane must not hide the sessions that did receive it.
      const outcomes = await Promise.allSettled(
        sessions.map((session) => bridge.sendInput(session.id, deliveryText)),
      );
      deliveredToSessions = outcomes.filter((o) => o.status === "fulfilled" && o.value).length;
    }
    // Marked once, and only when something actually arrived. `markDelivered` on a
    // message nobody received is the same lie as returning a positive count.
    if (deliveredToSessions > 0) deps.store.markDelivered(message.id);
  } catch {
    // Session bridge not initialized — recipient will pull via MCP. Count stays 0.
  }

  logInfo("direct message delivered (awaited)", { from, to, messageId: message.id, deliveredToSessions });

  return { messageId: message.id, timestamp: message.createdAt, conversationId, deliveredToSessions };
}
