/**
 * MCP Messaging Tools for Adjutant.
 *
 * Registers send_message, read_messages, list_threads, and mark_read
 * tools on the MCP server for agent-to-user messaging.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MessageStore } from "../message-store.js";
import { wsBroadcast, wsBroadcastToConversation } from "../ws-server.js";
import { dmConversationId } from "../conversation-store.js";
import { deliverChannelPostToAgents } from "../channel-delivery.js";
import { getAgentBySession } from "../mcp-server.js";
import { isAPNsConfigured, sendNotificationToAll } from "../apns-service.js";
import { logInfo, logWarn } from "../../utils/index.js";
import type { EventStore } from "../event-store.js";
import type { ConversationStore } from "../conversation-store.js";

/**
 * Register all messaging MCP tools on the given server.
 *
 * @param conversationStore - when provided, `send_message` with a `conversationId`
 *   routes the message into that conversation (channel post) with room-scoped
 *   fan-out instead of the legacy global broadcast.
 */
export function registerMessagingTools(
  server: McpServer,
  store: MessageStore,
  eventStore?: EventStore,
  conversationStore?: ConversationStore,
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
