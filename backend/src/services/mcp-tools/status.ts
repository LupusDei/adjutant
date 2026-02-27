/**
 * MCP Status Tools for Adjutant.
 *
 * Provides set_status, report_progress, and announce tools that agents
 * call via MCP to report their status, progress, and announcements.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wsBroadcast } from "../ws-server.js";
import { getAgentBySession, getProjectContextBySession } from "../mcp-server.js";
import { getSessionBridge } from "../session-bridge.js";
import type { SessionStatus } from "../session-registry.js";
import { isAPNsConfigured, sendNotificationToAll } from "../apns-service.js";
import { logWarn } from "../../utils/index.js";
import type { MessageStore } from "../message-store.js";

// ============================================================================
// Types
// ============================================================================

export interface AgentStatus {
  agentId: string;
  status: "working" | "blocked" | "idle" | "done";
  task?: string | undefined;
  beadId?: string | undefined;
  /** Project this agent is scoped to (undefined = legacy/unscoped) */
  projectId?: string | undefined;
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

/**
 * Remove a disconnected agent's status entry.
 * Called when an MCP agent disconnects to prevent stale status data
 * from persisting and being applied to future agent listings.
 */
export function clearAgentStatus(agentId: string): void {
  agentStatuses.delete(agentId);
}

// ============================================================================
// Helpers
// ============================================================================

function resolveAgent(extra: { sessionId?: string }): string | undefined {
  if (!extra.sessionId) return undefined;
  return getAgentBySession(extra.sessionId);
}

function resolveProjectId(extra?: { sessionId?: string }): string | undefined {
  if (!extra?.sessionId) return undefined;
  return getProjectContextBySession(extra.sessionId)?.projectId;
}

function unknownAgentError() {
  return {
    content: [{ type: "text" as const, text: "Unknown agent: session not found" }],
    isError: true,
  };
}

/**
 * Map MCP agent status to SessionRegistry status and update the SessionBridge.
 * This bridges the gap so /api/agents reflects MCP status changes.
 */
function syncToSessionBridge(agentId: string, mcpStatus: string): void {
  const bridge = getSessionBridge();
  if (!bridge.isInitialized) return;

  const statusMap: Record<string, SessionStatus> = {
    working: "working",
    blocked: "idle",
    idle: "idle",
    done: "idle",
  };
  const sessionStatus = statusMap[mcpStatus] ?? "idle";

  // Find session by name matching the agent ID
  const sessions = bridge.listSessions();
  for (const session of sessions) {
    if (session.name === agentId) {
      bridge.updateSessionStatus(session.id, sessionStatus);
      return;
    }
  }
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

      const projectId = resolveProjectId(extra);
      const now = new Date().toISOString();

      // Preserve previous task/beadId when not explicitly provided
      const previous = agentStatuses.get(agentId);
      const resolvedTask = task ?? previous?.task;
      const resolvedBeadId = beadId ?? previous?.beadId;

      agentStatuses.set(agentId, {
        agentId,
        status,
        task: resolvedTask,
        beadId: resolvedBeadId,
        projectId,
        updatedAt: now,
      });

      // Sync to SessionBridge so /api/agents reflects this change
      syncToSessionBridge(agentId, status);

      wsBroadcast({
        type: "typing",
        from: agentId,
        state: status,
        metadata: { type: "agent_status", status, task: resolvedTask, beadId: resolvedBeadId, projectId },
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
        metadata: { type: "agent_status", status: "working", task, percentage, description },
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

      const projectId = resolveProjectId(extra);
      const formattedBody = `[${type.toUpperCase()}] ${title}: ${body}`;

      const message = store.insertMessage({
        agentId,
        recipient: "user",
        role: "announcement",
        body: formattedBody,
        eventType: "announcement",
        metadata: { announcementType: type, beadId, projectId },
      });

      // Send APNS push for announcements
      if (isAPNsConfigured()) {
        const truncatedBody = body.length > 200 ? body.slice(0, 197) + "..." : body;
        sendNotificationToAll({
          title: `${type.toUpperCase()}: ${title}`,
          body: truncatedBody,
          sound: "default",
          category: "AGENT_ANNOUNCEMENT",
          threadId: "announcements",
          data: {
            type: "announcement",
            messageId: message.id,
            agentId,
            body: truncatedBody,
            announcementType: type,
            beadId,
          },
        }).catch((err) => {
          logWarn("Failed to send APNS for announcement", { error: String(err) });
        });
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ messageId: message.id, timestamp: message.createdAt }),
        }],
      };
    },
  );
}
