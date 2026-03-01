/**
 * Agents service for Adjutant.
 *
 * Retrieves and transforms agent information into CrewMember format
 * for the dashboard display using bd/tmux data.
 */

import { getEventBus } from "./event-bus.js";
import { listTmuxSessions } from "./tmux.js";
import { getSessionBridge } from "./session-bridge.js";
import { getConnectedAgents } from "./mcp-server.js";
import { getAgentStatuses } from "./mcp-tools/status.js";
import type { CrewMember, CrewMemberStatus, AgentType } from "../types/index.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Result type for agents service operations.
 */
export interface AgentsServiceResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Enriches CrewMembers with session data from the SessionBridge.
 * Adds lastActivity, worktreePath, sessionId, and swarm metadata.
 */
function enrichWithSessionData(members: CrewMember[]): void {
  const bridge = getSessionBridge();
  const sessions = bridge.listSessions();

  for (const member of members) {
    // Match by session ID (if already set) or by name
    const session = member.sessionId
      ? sessions.find((s) => s.id === member.sessionId)
      : sessions.find((s) => s.name === member.name);

    if (session) {
      if (!member.sessionId) member.sessionId = session.id;
      member.lastActivity = session.lastActivity;
      if (session.workspaceType === "worktree") {
        member.worktreePath = session.projectPath;
      }
    }
  }
}

// ============================================================================
// Status Change Tracking
// ============================================================================

/** Previous agent statuses keyed by agent id (address). */
const previousStatuses = new Map<string, CrewMemberStatus>();

/**
 * Reset the status tracking cache (for testing).
 */
export function resetAgentStatusCache(): void {
  previousStatuses.clear();
}

/**
 * Compares current agent statuses against cached state and emits
 * agent:status_changed events for any differences.
 */
function emitStatusChanges(agents: CrewMember[]): void {
  const eventBus = getEventBus();

  for (const agent of agents) {
    const prev = previousStatuses.get(agent.id);
    if (prev !== undefined && prev !== agent.status) {
      const event: { agent: string; status: string; activity?: string } = {
        agent: agent.id,
        status: agent.status,
      };
      if (agent.currentTask) event.activity = agent.currentTask;
      eventBus.emit("agent:status_changed", event);
    }
    previousStatuses.set(agent.id, agent.status);
  }
}

// ============================================================================
// MCP Agent Merging
// ============================================================================

/**
 * Enriches existing CrewMembers with MCP status data.
 * Updates status and currentTask from the in-memory agentStatuses map
 * populated by set_status MCP tool calls.
 *
 * Only enriches agents that have an active MCP connection to avoid
 * applying stale status from disconnected agents.
 */
function enrichWithMcpStatus(members: CrewMember[]): void {
  const statuses = getAgentStatuses();
  const connectedIds = new Set(getConnectedAgents().map((c) => c.agentId));

  for (const member of members) {
    const mcpStatus = statuses.get(member.id) ?? statuses.get(member.name);
    if (!mcpStatus) continue;

    const isConnected = connectedIds.has(member.id) || connectedIds.has(member.name);
    if (!isConnected) continue;

    // Apply MCP status for ALL states
    const statusMap: Record<string, CrewMemberStatus> = {
      working: "working",
      blocked: "blocked",
      idle: "idle",
      done: "idle",
    };
    const mapped = statusMap[mcpStatus.status];
    if (mapped) {
      member.status = mapped;
    }

    // MCP task always takes priority (more current than hookBead)
    if (mcpStatus.task) {
      member.currentTask = mcpStatus.task;
    }
  }
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Gets all agents as CrewMember list for the dashboard.
 * Discovers agents from tmux sessions + managed sessions.
 * Merges MCP-connected agents so all active agents are visible.
 * Emits agent:status_changed events when agent statuses change.
 */
export async function getAgents(): Promise<AgentsServiceResult<CrewMember[]>> {
  return await getTmuxAgents();
}

/**
 * Discovers agents from tmux sessions for swarm mode.
 * Merges tmux session data with managed session data from the SessionBridge.
 */
async function getTmuxAgents(): Promise<AgentsServiceResult<CrewMember[]>> {
  try {
    const tmuxSessions = await listTmuxSessions();
    const bridge = getSessionBridge();
    const managedSessions = bridge.listSessions();

    const crewMembers: CrewMember[] = [];

    // Build a set of tmux sessions already tracked by managed sessions
    const managedTmuxSessions = new Set(
      managedSessions.map((s) => s.tmuxSession)
    );

    // Add managed sessions as agents
    for (const session of managedSessions) {
      const isRunning = tmuxSessions.has(session.tmuxSession);
      const member: CrewMember = {
        id: session.name,
        name: session.name,
        type: "crew" as AgentType,
        rig: "",
        status: isRunning
          ? session.status === "working"
            ? "working"
            : "idle"
          : "offline",
        sessionId: session.id,
        unreadMail: 0,
        lastActivity: session.lastActivity,
      };
      if (session.workspaceType === "worktree") {
        member.worktreePath = session.projectPath;
      }
      crewMembers.push(member);
    }

    // Add unmanaged tmux sessions (e.g. user-created tmux sessions running claude)
    for (const tmuxName of tmuxSessions) {
      if (managedTmuxSessions.has(tmuxName)) continue;
      // Only include sessions that look like agent sessions
      if (!tmuxName.includes("claude") && !tmuxName.includes("agent")) continue;

      crewMembers.push({
        id: tmuxName,
        name: tmuxName,
        type: "crew" as AgentType,
        rig: "",
        status: "idle",
      });
    }

    enrichWithSessionData(crewMembers);
    enrichWithMcpStatus(crewMembers);
    crewMembers.sort((a, b) => a.name.localeCompare(b.name));
    emitStatusChanges(crewMembers);
    return { success: true, data: crewMembers };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "TMUX_AGENTS_ERROR",
        message: err instanceof Error ? err.message : "Failed to discover tmux agents",
      },
    };
  }
}
