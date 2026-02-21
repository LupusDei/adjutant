/**
 * MCP Messaging Tools for Adjutant.
 *
 * Registers send_message, read_messages, list_threads, and mark_read
 * tools on the MCP server for agent-to-user messaging.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MessageStore } from "../message-store.js";
import { wsBroadcast } from "../ws-server.js";
import { isAPNsConfigured, sendNotificationToAll } from "../apns-service.js";
import { logInfo, logWarn } from "../../utils/index.js";

/**
 * Resolve the agent identity from the MCP tool call extra context.
 * Falls back to "unknown-agent" if not available.
 */
function resolveAgentFromExtra(extra: Record<string, unknown>): string {
  // The _meta field may contain agentId from the connection context
  const meta = extra["_meta"] as Record<string, unknown> | undefined;
  if (meta && typeof meta["agentId"] === "string" && meta["agentId"].length > 0) {
    return meta["agentId"];
  }

  // Fallback to sessionId-based identity
  if (typeof extra["sessionId"] === "string") {
    return `agent-${extra["sessionId"]}`;
  }

  return "unknown-agent";
}

/**
 * Register all messaging MCP tools on the given server.
 */
export function registerMessagingTools(server: McpServer, store: MessageStore): void {
  // ========================================================================
  // send_message
  // ========================================================================
  server.tool(
    "send_message",
    {
      to: z.string().describe("Recipient: 'user', 'mayor/', or agent name"),
      body: z.string().describe("Message body"),
      threadId: z.string().optional().describe("Thread ID for conversation grouping"),
      metadata: z.record(z.string(), z.unknown()).optional().describe("Optional metadata"),
    },
    async ({ to, body, threadId, metadata }, extra) => {
      const agentId = resolveAgentFromExtra(extra as Record<string, unknown>);

      // 1. Store the message
      const insertInput: Parameters<typeof store.insertMessage>[0] = {
        agentId,
        recipient: to,
        role: "agent",
        body,
      };
      if (threadId !== undefined) insertInput.threadId = threadId;
      if (metadata !== undefined) insertInput.metadata = metadata;
      const message = store.insertMessage(insertInput);

      logInfo("MCP send_message", { agentId, to, messageId: message.id });

      // 2. Broadcast via WebSocket
      wsBroadcast({
        type: "chat_message" as any,
        id: message.id,
        from: agentId,
        to,
        body: message.body,
        timestamp: message.createdAt,
        threadId: message.threadId ?? undefined,
        metadata: message.metadata ?? undefined,
      });

      // 3. Send APNS push if applicable (to "user" or "mayor/")
      if ((to === "user" || to === "mayor/") && isAPNsConfigured()) {
        sendNotificationToAll({
          title: `Message from ${agentId}`,
          body: body.length > 200 ? body.slice(0, 197) + "..." : body,
          sound: "default",
          category: "AGENT_MESSAGE",
          threadId: threadId ?? "messages",
          data: {
            type: "agent_message",
            messageId: message.id,
            from: agentId,
          },
        }).catch((err) => {
          logWarn("Failed to send APNS for agent message", { error: String(err) });
        });
      }

      // 4. Return result
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

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ messages }),
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
