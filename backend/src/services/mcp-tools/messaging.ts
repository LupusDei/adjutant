/**
 * MCP Messaging Tools for Adjutant.
 *
 * Registers send_message, direct_message, read_messages, list_threads, and mark_read
 * tools on the MCP server for agent-to-user and agent-to-agent messaging.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MessageStore } from "../message-store.js";
import { wsBroadcast, wsBroadcastToConversation } from "../ws-server.js";
import { dmConversationId } from "../conversation-store.js";
import { deliverChannelPostToAgents } from "../channel-delivery.js";
import { getAgentBySession } from "../mcp-server.js";
import { isAPNsConfigured, sendNotificationToAll } from "../apns-service.js";
import { deliverDirectMessageAwaited } from "../direct-message-delivery.js";
import type { RecipientResolver } from "../agent-recipient-resolver.js";
import { logInfo, logWarn } from "../../utils/index.js";
import type { EventStore } from "../event-store.js";
import type { ConversationStore } from "../conversation-store.js";

/**
 * Prefix on the text injected into the recipient's tmux session, so the receiving agent
 * can see who it is from and has a name to reply to. Mirrors `BRIDGE_DIRECTIVE_PREFIX`,
 * which does the same job for the coordinator's directives.
 */
export const DIRECT_MESSAGE_PREFIX = "[DM from ";

/** The injected text for an agent→agent direct message. */
export function directMessageDeliveryText(from: string, body: string): string {
  return `${DIRECT_MESSAGE_PREFIX}${from}] ${body}`;
}

/**
 * What `direct_message` tells the model it is. This string is the tool's whole contract
 * with a model deciding whether its message arrived, so it states the failure mode
 * explicitly: a verb whose failure mode is undocumented gets narrated as success
 * (syl-j8fa).
 */
const DIRECT_MESSAGE_DESCRIPTION = [
  "Send a direct message to ANOTHER AGENT by name and deliver it into that agent's live session.",
  "Unlike send_message, which only stores the message for the recipient to pull later, this",
  "injects the text into the recipient's running session and WAITS to find out whether the",
  "injection succeeded.",
  "",
  "It returns deliveredToSessions: the number of live sessions the text was actually injected",
  "into. deliveredToSessions of 0 means NOBODY RECEIVED IT — the message is stored, but no",
  "running agent saw it and none will act on it. Do not report a message as sent, delivered, or",
  "acknowledged when deliveredToSessions is 0; say it could not be delivered.",
  "",
  "It also returns sessionsFound: how many sessions Adjutant holds a RECORD of for that name,",
  "counted before delivery was attempted. Read it to say WHY a delivery of 0 failed:",
  "  sessionsFound 0 — no session is on record for them, so there was nothing to deliver into.",
  "  sessionsFound above 0 — a session is on record and nothing accepted the message. Usually",
  "  that is an agent which is up but unreachable; it can also be one that stopped without its",
  "  record being cleaned up. Retrying later is reasonable either way.",
  "This number does NOT establish whether the agent is currently running. Do not tell anyone an",
  "agent is up, or down, on the strength of it — say what it actually reports: whether a session",
  "was on record, and that nothing accepted the message.",
  "",
  "Recipients are agent names only. To message the Commander (to: 'user' or 'mayor/'), use",
  "send_message instead — that direction carries the phone push and has its own handler.",
  "",
  "A name that does not match a registered agent is REJECTED: you get an error naming the",
  "agent you asked for, nothing is stored, and nothing is sent. That is different from a",
  "delivery of 0, which means the agent is real. Fix the name and try again.",
].join("\n");

/**
 * Register all messaging MCP tools on the given server.
 *
 * @param conversationStore - when provided, `send_message` with a `conversationId`
 *   routes the message into that conversation (channel post) with room-scoped
 *   fan-out instead of the legacy global broadcast.
 */
export interface MessagingToolOptions {
  /**
   * Resolves a recipient name against the live agent roster (syl-j8fa.7). When wired,
   * `direct_message` rejects a name that resolves to nothing instead of persisting a
   * message to a phantom recipient. Injected rather than imported so this module stays
   * testable without a live roster — and so the ONE resolver the Bridge path already
   * uses is the one that runs here.
   *
   * Absent ⇒ no validation, i.e. the pre-syl-j8fa.7 behaviour.
   */
  resolveRecipient?: RecipientResolver;
}

export function registerMessagingTools(
  server: McpServer,
  store: MessageStore,
  eventStore?: EventStore,
  conversationStore?: ConversationStore,
  options?: MessagingToolOptions,
): void {
  // ========================================================================
  // send_message
  // ========================================================================
  server.tool(
    "send_message",
    {
      to: z.string().describe("Recipient: 'user', 'mayor/', agent name, or channel/conversation id"),
      body: z.string().describe("Message body"),
      threadId: z.string().optional().describe("Thread ID for conversation grouping"),
      conversationId: z.string().optional().describe("Target conversation/channel id (channel post)"),
      metadata: z.record(z.string(), z.unknown()).optional().describe("Optional metadata"),
    },
    async ({ to, body, threadId, conversationId, metadata }, extra) => {
      const agentId = extra.sessionId ? getAgentBySession(extra.sessionId) : undefined;
      if (!agentId) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown session" }) }],
        };
      }

      // Channel post path: when a conversationId is supplied and a conversation
      // store is wired, persist + fan out room-scoped. Membership is enforced in
      // postToChannel, so non-members are rejected here rather than leaking.
      if (conversationId !== undefined && conversationStore !== undefined) {
        try {
          const postInput: Parameters<typeof conversationStore.postToChannel>[0] = {
            channelId: conversationId,
            senderId: agentId,
            body,
          };
          if (metadata !== undefined) postInput.metadata = metadata;
          const channelMessage = conversationStore.postToChannel(postInput);

          logInfo("MCP send_message (channel)", { agentId, conversationId, messageId: channelMessage.id });

          wsBroadcastToConversation(conversationId, {
            type: "chat_message",
            id: channelMessage.id,
            from: agentId,
            to,
            body: channelMessage.body,
            timestamp: channelMessage.createdAt,
            conversationId,
            metadata: channelMessage.metadata ?? undefined,
          });

          // Inject into each OTHER agent member's CLI, tagged as a channel message.
          deliverChannelPostToAgents(conversationStore, { channelId: conversationId, senderId: agentId, body });

          // Push to the iOS operator when they're a channel member and not the
          // sender. The DM APNS block below only covers to:"user"/"mayor/"; a
          // channel post never has those recipients, so without this an agent's
          // channel post would never notify the user. View-time suppression is
          // handled client-side (NotificationService).
          if (isAPNsConfigured() && agentId !== "user") {
            const channelMembers = conversationStore.getMembers(conversationId);
            if (channelMembers.some((m) => m.memberId === "user")) {
              const channel = conversationStore.getConversation(conversationId);
              const truncated = body.length > 200 ? body.slice(0, 197) + "..." : body;
              sendNotificationToAll({
                title: channel?.title ? `#${channel.title}` : "Channel message",
                body: `${agentId}: ${truncated}`,
                sound: "default",
                category: "CHANNEL_MESSAGE",
                threadId: conversationId,
                data: {
                  type: "channel_message",
                  conversationId,
                  channelTitle: channel?.title ?? undefined,
                  senderId: agentId,
                  body: truncated,
                },
              }).catch((err) => {
                logWarn("Failed to send APNS for channel post", { error: String(err), conversationId });
              });
            }
          }

          eventStore?.insertEvent({
            eventType: "message_sent",
            agentId,
            action: `Channel post to ${conversationId}`,
            detail: { conversationId },
            messageId: channelMessage.id,
          });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  messageId: channelMessage.id,
                  timestamp: channelMessage.createdAt,
                  conversationId,
                }),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
              },
            ],
          };
        }
      }
      // DM path (no channel target): tag the message with the deterministic DM
      // conversation id. The user-facing DM is keyed on the canonical "user"
      // member, so both "user" and the legacy "mayor/" alias normalize to "user"
      // — that way an agent's reply lands in the SAME conversation the user has
      // open for that agent (dmConversationId is order-independent over the pair).
      const dmPeer = to === "mayor/" ? "user" : to;
      const dmConvId = dmConversationId(agentId, dmPeer);

      // 1. Store the message
      const insertInput: Parameters<typeof store.insertMessage>[0] = {
        agentId,
        recipient: to,
        role: "agent",
        body,
        conversationId: dmConvId,
      };
      if (threadId !== undefined) insertInput.threadId = threadId;
      if (metadata !== undefined) insertInput.metadata = metadata;
      const message = store.insertMessage(insertInput);

      logInfo("MCP send_message", { agentId, to, messageId: message.id });

      // 2. Broadcast via WebSocket
      wsBroadcast({
        type: "chat_message",
        id: message.id,
        from: agentId,
        to,
        body: message.body,
        timestamp: message.createdAt,
        threadId: message.threadId ?? undefined,
        conversationId: message.conversationId ?? undefined,
        metadata: message.metadata ?? undefined,
      });

      // 3. Emit timeline event
      eventStore?.insertEvent({
        eventType: "message_sent",
        agentId,
        action: `Message to ${to}`,
        detail: { to, threadId },
        messageId: message.id,
      });

      // 4. Send APNS push if applicable (to "user" or "mayor/")
      if ((to === "user" || to === "mayor/") && isAPNsConfigured()) {
        const truncatedBody = body.length > 200 ? body.slice(0, 197) + "..." : body;
        sendNotificationToAll({
          title: `Message from ${agentId}`,
          body: truncatedBody,
          sound: "default",
          category: "AGENT_MESSAGE",
          threadId: threadId ?? "messages",
          data: {
            type: "chat_message",
            messageId: message.id,
            agentId,
            body: truncatedBody,
          },
        }).catch((err) => {
          logWarn("Failed to send APNS for agent message", { error: String(err) });
        });
      }

      // 5. Return result
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              messageId: message.id,
              timestamp: message.createdAt,
            }),
          },
        ],
      };
    },
  );

  // ========================================================================
  // direct_message (syl-j8fa.2)
  //
  // Additive: send_message above is untouched, so no existing agent's messaging
  // behaviour changes. The difference that matters is the AWAITED injection —
  // deliverDirectMessageAwaited counts sends that actually resolved true, so the
  // number this tool hands back is arrival, not "a live session exists".
  // ========================================================================
  server.tool(
    "direct_message",
    DIRECT_MESSAGE_DESCRIPTION,
    {
      to: z
        .string()
        .describe("Recipient AGENT NAME. Not 'user' or 'mayor/' — use send_message for the Commander."),
      body: z.string().describe("Message body. Delivered into the recipient's live session."),
      threadId: z.string().optional().describe("Thread ID for conversation grouping"),
      metadata: z.record(z.string(), z.unknown()).optional().describe("Optional metadata"),
    },
    async ({ to, body, threadId, metadata }, extra) => {
      // Identity is the session handshake's answer, never an argument: an agent must not
      // be able to send as someone else by claiming to.
      const agentId = extra.sessionId ? getAgentBySession(extra.sessionId) : undefined;
      if (!agentId) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown session" }) }],
        };
      }

      // The agent→user direction carries the APNS push and has its own handler; routing it
      // through here would deliver to the Commander's (nonexistent) session and skip the
      // push entirely. Reject before anything is persisted.
      if (to === "user" || to === "mayor/") {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error:
                  `direct_message delivers to agent sessions only; "${to}" is the Commander. ` +
                  `Use send_message to reach the Commander — that path carries the phone push.`,
              }),
            },
          ],
        };
      }

      // syl-j8fa.7: resolve the name against the roster through the SAME resolver the
      // Bridge path uses. An unresolvable name used to persist a message to a phantom
      // recipient and come back as a 0 delivery, indistinguishable from a real agent
      // who is simply not running.
      //
      // A roster we could not READ is deliberately NOT a rejection: "I checked and that
      // name is not on it" is the sender's mistake, "I could not check" is ours, and
      // blaming the sender for an outage is the same false report this tool exists to
      // stop. In that case the name is used as given, which is the pre-validation
      // behaviour.
      let recipient = to;
      if (options?.resolveRecipient) {
        const resolution = await options.resolveRecipient(to);
        if (resolution.status === "unknown") {
          const hint = resolution.candidates.length
            ? ` Did you mean: ${resolution.candidates.join(", ")}?`
            : "";
          logWarn("MCP direct_message rejected: unresolvable recipient", { agentId, to });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: `No agent named "${to}".${hint} Nothing was sent — no message was stored.`,
                }),
              },
            ],
          };
        }
        if (resolution.status === "resolved" && resolution.canonical) {
          recipient = resolution.canonical;
        }
      }

      const result = await deliverDirectMessageAwaited(
        { store, ...(eventStore !== undefined ? { eventStore } : {}) },
        {
          from: agentId,
          to: recipient,
          body,
          role: "agent",
          emitEvent: true,
          deliveryText: directMessageDeliveryText(agentId, body),
          ...(threadId !== undefined ? { threadId } : {}),
          ...(metadata !== undefined ? { metadata } : {}),
        },
      );

      logInfo("MCP direct_message", {
        agentId,
        to: recipient,
        messageId: result.messageId,
        deliveredToSessions: result.deliveredToSessions,
        sessionsFound: result.sessionsFound,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              messageId: result.messageId,
              timestamp: result.timestamp,
              conversationId: result.conversationId,
              deliveredToSessions: result.deliveredToSessions,
              // Splits a 0 delivery into "no agent by that name is running" and "the
              // agent is running and the injection failed" — different things to tell
              // the Commander, and he can act on the first.
              sessionsFound: result.sessionsFound,
            }),
          },
        ],
      };
    },
  );

  // ========================================================================
  // read_messages
  // ========================================================================
  server.tool(
    "read_messages",
    {
      threadId: z.string().optional().describe("Filter by thread ID"),
      agentId: z.string().optional().describe("Filter by agent ID"),
      limit: z.number().optional().describe("Max messages to return (default 50)"),
      before: z.string().optional().describe("Cursor: return messages before this timestamp"),
      beforeId: z.string().optional().describe("Cursor: disambiguate same-second messages"),
    },
    async ({ threadId, agentId, limit, before, beforeId }) => {
      const opts: Parameters<typeof store.getMessages>[0] = {
        limit: limit ?? 50,
      };
      if (threadId !== undefined) opts.threadId = threadId;
      if (agentId !== undefined) opts.agentId = agentId;
      if (before !== undefined) opts.before = before;
      if (beforeId !== undefined) opts.beforeId = beforeId;
      const messages = store.getMessages(opts);
      // DB returns DESC (newest first) for cursor pagination; reverse to ASC for display
      const chronological = [...messages].reverse();

      // Mark pending messages as delivered since the agent just fetched them
      for (const msg of chronological) {
        if (msg.deliveryStatus === "pending") {
          store.markDelivered(msg.id);
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ messages: chronological }),
          },
        ],
      };
    },
  );

  // ========================================================================
  // list_threads
  // ========================================================================
  server.tool(
    "list_threads",
    {
      agentId: z.string().optional().describe("Filter threads by agent ID"),
    },
    async ({ agentId }) => {
      const threads = store.getThreads(agentId);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ threads }),
          },
        ],
      };
    },
  );

  // ========================================================================
  // mark_read
  // ========================================================================
  server.tool(
    "mark_read",
    {
      messageId: z.string().optional().describe("Mark a single message as read"),
      agentId: z.string().optional().describe("Mark all messages from this agent as read"),
    },
    async ({ messageId, agentId }) => {
      if (!messageId && !agentId) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Either messageId or agentId is required" }),
            },
          ],
        };
      }

      if (messageId) {
        store.markRead(messageId);
        logInfo("MCP mark_read", { messageId });
      } else if (agentId) {
        store.markAllRead(agentId);
        logInfo("MCP mark_all_read", { agentId });
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ success: true }),
          },
        ],
      };
    },
  );
}
