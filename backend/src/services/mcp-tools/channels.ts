/**
 * MCP Channel Tools for Adjutant (adj-164.4.2).
 *
 * Registers create_channel, list_channels, join_channel, and leave_channel.
 * Channels reuse the unified conversation model (a channel is a conversation
 * with kind='channel'); these tools delegate to the ConversationStore.
 *
 * Identity is resolved SERVER-SIDE via getAgentBySession — the calling agent's
 * id is never trusted from client-supplied params (Constitution / Rule 4).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ConversationStore } from "../conversation-store.js";
import { getAgentBySession } from "../mcp-server.js";
import { logInfo } from "../../utils/index.js";

/** Wrap a JSON payload in the MCP text-content envelope. */
function jsonContent(payload: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

/**
 * Register the channel MCP tools on the given server.
 */
export function registerChannelTools(server: McpServer, store: ConversationStore): void {
  // ========================================================================
  // create_channel
  // ========================================================================
  server.tool(
    "create_channel",
    {
      title: z.string().describe("Channel name (display title)"),
    },
    async ({ title }, extra) => {
      const agentId = extra.sessionId ? getAgentBySession(extra.sessionId) : undefined;
      if (!agentId) {
        return jsonContent({ error: "Unknown session" });
      }
      try {
        const channel = store.createChannel({ title, createdBy: agentId });
        logInfo("MCP create_channel", { agentId, channelId: channel.id, title });
        return jsonContent({ channelId: channel.id, title: channel.title });
      } catch (err) {
        return jsonContent({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // ========================================================================
  // list_channels
  // ========================================================================
  server.tool("list_channels", {}, async () => {
    const channels = store.listChannels();
    return jsonContent({ channels });
  });

  // ========================================================================
  // join_channel
  // ========================================================================
  server.tool(
    "join_channel",
    {
      channelId: z.string().describe("Channel (conversation) id to join"),
    },
    async ({ channelId }, extra) => {
      const agentId = extra.sessionId ? getAgentBySession(extra.sessionId) : undefined;
      if (!agentId) {
        return jsonContent({ error: "Unknown session" });
      }
      try {
        store.joinChannel(channelId, {
          memberId: agentId,
          memberKind: agentId === "user" ? "user" : "agent",
        });
        logInfo("MCP join_channel", { agentId, channelId });
        return jsonContent({ success: true });
      } catch (err) {
        return jsonContent({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // ========================================================================
  // leave_channel
  // ========================================================================
  server.tool(
    "leave_channel",
    {
      channelId: z.string().describe("Channel (conversation) id to leave"),
    },
    async ({ channelId }, extra) => {
      const agentId = extra.sessionId ? getAgentBySession(extra.sessionId) : undefined;
      if (!agentId) {
        return jsonContent({ error: "Unknown session" });
      }
      try {
        store.leaveChannel(channelId, agentId);
        logInfo("MCP leave_channel", { agentId, channelId });
        return jsonContent({ success: true });
      } catch (err) {
        return jsonContent({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
}
