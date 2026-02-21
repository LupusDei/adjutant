/**
 * MCP Status Tools for Adjutant.
 *
 * Provides set_status, report_progress, and announce tools that agents
 * call via MCP to report their status, progress, and announcements.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wsBroadcast } from "../ws-server.js";
import { getAgentBySession } from "../mcp-server.js";
import type { MessageStore } from "../message-store.js";

// ============================================================================
// Types
// ============================================================================

export interface AgentStatus {
  agentId: string;
  status: "working" | "blocked" | "idle" | "done";
  task?: string | undefined;
  beadId?: string | undefined;
  updatedAt: string;
}

// ============================================================================
// State (in-memory)
// ============================================================================

const agentStatuses = new Map<string, AgentStatus>();

/**
 * Get all current agent statuses.
 */
export function getAgentStatuses(): Map<string, AgentStatus> {
  return agentStatuses;
}

/**
 * Reset agent statuses (for testing).
 */
export function resetAgentStatuses(): void {
  agentStatuses.clear();
}

// ============================================================================
// Helpers
// ============================================================================

function resolveAgent(extra: { sessionId?: string }): string | undefined {
  if (!extra.sessionId) return undefined;
  return getAgentBySession(extra.sessionId);
}

function unknownAgentError() {
  return {
    content: [{ type: "text" as const, text: "Unknown agent: session not found" }],
    isError: true,
  };
}

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Register set_status, report_progress, and announce tools on the MCP server.
 */
export function registerStatusTools(server: McpServer, store: MessageStore): void {
  // --------------------------------------------------------------------------
  // set_status
  // --------------------------------------------------------------------------
  server.tool(
    "set_status",
    "Set the agent's current status (working, blocked, idle, done)",
    {
      status: z.enum(["working", "blocked", "idle", "done"]).describe("Agent status"),
      task: z.string().optional().describe("Current task description"),
      beadId: z.string().optional().describe("Bead ID being worked on"),
    },
    async ({ status, task, beadId }, extra) => {
      const agentId = resolveAgent(extra);
      if (!agentId) return unknownAgentError();

      const now = new Date().toISOString();

      agentStatuses.set(agentId, {
        agentId,
        status,
        task,
        beadId,
        updatedAt: now,
      });

      wsBroadcast({
        type: "typing",
        from: agentId,
        state: status,
        metadata: { task, beadId },
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ acknowledged: true, status }) }],
      };
    },
  );

  // --------------------------------------------------------------------------
  // report_progress
  // --------------------------------------------------------------------------
  server.tool(
    "report_progress",
    "Report progress on a task with percentage",
    {
      task: z.string().describe("Task being worked on"),
      percentage: z.number().min(0).max(100).describe("Completion percentage"),
      description: z.string().optional().describe("Progress details"),
    },
    async ({ task, percentage, description }, extra) => {
      const agentId = resolveAgent(extra);
      if (!agentId) return unknownAgentError();

      wsBroadcast({
        type: "typing",
        from: agentId,
        state: "working",
        metadata: { task, percentage, description },
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ acknowledged: true, percentage }) }],
      };
    },
  );

  // --------------------------------------------------------------------------
  // announce
  // --------------------------------------------------------------------------
  server.tool(
    "announce",
    "Make an announcement (completion, blocker, or question)",
    {
      type: z.enum(["completion", "blocker", "question"]).describe("Announcement type"),
      title: z.string().describe("Announcement title"),
      body: z.string().describe("Announcement body"),
      beadId: z.string().optional().describe("Related bead ID"),
    },
    async ({ type, title, body, beadId }, extra) => {
      const agentId = resolveAgent(extra);
      if (!agentId) return unknownAgentError();

      const formattedBody = `[${type.toUpperCase()}] ${title}: ${body}`;

      const message = store.insertMessage({
        agentId,
        recipient: "user",
        role: "announcement",
        body: formattedBody,
        eventType: "announcement",
        metadata: { announcementType: type, beadId },
      });

      wsBroadcast({
        type: "message",
        id: message.id,
        from: agentId,
        body: formattedBody,
        timestamp: message.createdAt,
        metadata: { announcementType: type, beadId },
      });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ messageId: message.id, timestamp: message.createdAt }),
        }],
      };
    },
  );
}
