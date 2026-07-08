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
import type { EventStore } from "../event-store.js";
import { dmConversationId } from "../conversation-store.js";
import { getEventBus } from "../event-bus.js";
import type { AgentStatusStore } from "../agent-status-store.js";

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

/** Statuses that are valid to hydrate back into the typed in-memory Map. */
const HYDRATABLE_STATUSES: ReadonlySet<AgentStatus["status"]> = new Set([
  "working",
  "blocked",
  "idle",
  "done",
]);

/**
 * adj-pyhm4: optional write-through persistence for last-known status.
 *
 * The in-memory `agentStatuses` Map is wiped on every backend restart. When a
 * store is wired (production boot), each status transition is mirrored to it so
 * the roster can be hydrated on the next boot instead of showing a false
 * all-idle state. Null in unit tests that don't exercise persistence.
 */
let persistentStore: AgentStatusStore | null = null;

/**
 * Wire (or clear) the persistence store. Called once at boot from index.ts.
 * Passing null disables write-through (used by tests / reset).
 */
export function setAgentStatusStore(store: AgentStatusStore | null): void {
  persistentStore = store;
}

/** Mirror a status transition into the persistent snapshot (best-effort). */
function persistStatus(s: AgentStatus): void {
  if (!persistentStore) return;
  persistentStore.upsert({
    agentId: s.agentId,
    status: s.status,
    currentTask: s.task,
    beadId: s.beadId,
    projectId: s.projectId,
    updatedAt: s.updatedAt,
  });
}

/**
 * Populate the in-memory Map from the persistent snapshot on boot (adj-pyhm4).
 * Rows with an unrecognized status value are skipped (keeps the Map typed).
 * Returns the number of statuses hydrated. No-op when no store is wired.
 */
export function hydrateStatusesFromStore(): number {
  if (!persistentStore) return 0;
  let hydrated = 0;
  for (const snap of persistentStore.getAll()) {
    if (!HYDRATABLE_STATUSES.has(snap.status as AgentStatus["status"])) continue;
    agentStatuses.set(snap.agentId, {
      agentId: snap.agentId,
      status: snap.status as AgentStatus["status"],
      task: snap.currentTask,
      beadId: snap.beadId,
      projectId: snap.projectId,
      updatedAt: snap.updatedAt,
    });
    hydrated++;
  }
  return hydrated;
}

/**
 * Get all current agent statuses.
 */
export function getAgentStatuses(): Map<string, AgentStatus> {
  return agentStatuses;
}

/**
 * Reset agent statuses (for testing). Also detaches any persistence store so
 * a store wired by one test never leaks write-through into the next.
 */
export function resetAgentStatuses(): void {
  agentStatuses.clear();
  persistentStore = null;
}

/**
 * Remove a disconnected agent's LIVE status entry.
 * Called when an MCP agent disconnects to prevent stale status data
 * from being applied as if the agent were live.
 *
 * adj-pyhm4: this intentionally does NOT remove the PERSISTENT snapshot — the
 * whole point is to remember the last-known status across disconnects/restarts.
 * Liveness is derived separately from the live MCP connection registry.
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
export function registerStatusTools(server: McpServer, store: MessageStore, eventStore?: EventStore): void {
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

      const snapshot: AgentStatus = {
        agentId,
        status,
        task: resolvedTask,
        beadId: resolvedBeadId,
        projectId,
        updatedAt: now,
      };
      agentStatuses.set(agentId, snapshot);
      // adj-pyhm4: write-through to the persistent snapshot so this survives a
      // backend restart. Single mutation point — do NOT scatter this elsewhere.
      persistStatus(snapshot);

      // Sync to SessionBridge so /api/agents reflects this change
      syncToSessionBridge(agentId, status);

      wsBroadcast({
        type: "typing",
        from: agentId,
        state: status,
        metadata: { type: "agent_status", status, task: resolvedTask, beadId: resolvedBeadId, projectId },
      });

      // Emit timeline event
      const statusEventInput: Parameters<NonNullable<typeof eventStore>["insertEvent"]>[0] = {
        eventType: "status_change",
        agentId,
        action: resolvedTask ? `Status: ${status} — ${resolvedTask}` : `Status: ${status}`,
        detail: { status, task: resolvedTask, beadId: resolvedBeadId },
      };
      if (resolvedBeadId) statusEventInput.beadId = resolvedBeadId;
      eventStore?.insertEvent(statusEventInput);

      // Emit real-time EventBus event for subscribers (e.g., cost extraction)
      getEventBus().emit("agent:status_changed", {
        agent: agentId,
        agentId,
        status,
        beadId: resolvedBeadId,
        task: resolvedTask,
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

      // Emit timeline event
      eventStore?.insertEvent({
        eventType: "progress_report",
        agentId,
        action: task ? `Progress: ${percentage}% — ${task}` : `Progress: ${percentage}%`,
        detail: { task, percentage, description },
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
        // Scope announcements to the announcing agent's DM so they remain
        // visible under the strict conversation read (adj-164 regression fix).
        conversationId: dmConversationId(agentId, "user"),
        metadata: { announcementType: type, beadId, projectId },
      });

      // Broadcast via WebSocket so real-time clients receive announcements
      wsBroadcast({
        type: "chat_message",
        id: message.id,
        from: agentId,
        to: "user",
        body: message.body,
        timestamp: message.createdAt,
        metadata: message.metadata ?? undefined,
      });

      // Emit timeline event
      const announceEventInput: Parameters<NonNullable<typeof eventStore>["insertEvent"]>[0] = {
        eventType: "announcement",
        agentId,
        action: `${type}: ${title}`,
        detail: { type, title, body, beadId },
        messageId: message.id,
      };
      if (beadId) announceEventInput.beadId = beadId;
      eventStore?.insertEvent(announceEventInput);

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
