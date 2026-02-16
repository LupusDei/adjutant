/**
 * Agents service for Adjutant.
 *
 * Retrieves and transforms agent information into CrewMember format
 * for the dashboard display using bd/tmux data.
 */

import { collectAgentSnapshot, type AgentRuntimeInfo } from "./agent-data.js";
import { resolveWorkspaceRoot, getDeploymentMode } from "./workspace/index.js";
import { getTopology } from "./topology/index.js";
import { getEventBus } from "./event-bus.js";
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
 * Maps raw agent role string to AgentType using topology provider.
 * Handles both direct type names and role aliases.
 */
function mapAgentType(role: string): AgentType {
  const topology = getTopology();
  return topology.normalizeRole(role);
}

/**
 * Maps raw state string to CrewMemberStatus.
 * @param running Whether the agent's tmux session is running
 * @param state Explicit agent state (idle, working, blocked, stuck, etc.)
 * @param hasHookedWork Whether the agent has work hooked (bead assigned)
 */
function mapStatus(running: boolean, state?: string, hasHookedWork?: boolean): CrewMemberStatus {
  if (!running) return "offline";

  // If there's an explicit state, use it
  if (state) {
    const stateMap: Record<string, CrewMemberStatus> = {
      idle: "idle",
      working: "working",
      blocked: "blocked",
      stuck: "stuck",
      "awaiting-gate": "blocked",
    };
    return stateMap[state.toLowerCase()] ?? "idle";
  }

  // If no explicit state but has hooked work, they're working
  if (hasHookedWork) return "working";

  return "idle";
}

function transformAgent(agent: AgentRuntimeInfo): CrewMember {
  const hasHookedWork = Boolean(agent.hookBead);
  const result: CrewMember = {
    id: agent.address,
    name: agent.name,
    type: mapAgentType(agent.role),
    rig: agent.rig,
    status: mapStatus(agent.running, agent.state, hasHookedWork),
    unreadMail: agent.unreadMail,
  };
  // Mail preview - first unread subject and sender
  if (agent.firstSubject) {
    result.firstSubject = agent.firstSubject;
  }
  if (agent.firstFrom) {
    result.firstFrom = agent.firstFrom;
  }
  // Current work - from hook bead title (fetched in agent-data.ts)
  if (agent.hookBeadTitle) {
    result.currentTask = agent.hookBeadTitle;
  }
  if (agent.branch) {
    result.branch = agent.branch;
  }
  return result;
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
// Service Functions
// ============================================================================

/**
 * Gets all agents as CrewMember list for the dashboard.
 * Uses gt status --json which includes mail counts.
 * Emits agent:status_changed events when agent statuses change.
 */
export async function getAgents(): Promise<AgentsServiceResult<CrewMember[]>> {
  try {
    // Agents are a Gas Town concept — return empty in standalone/swarm mode
    if (getDeploymentMode() !== "gastown") {
      return { success: true, data: [] };
    }

    const townRoot = resolveWorkspaceRoot();
    const { agents } = await collectAgentSnapshot(townRoot);
    const crewMembers = agents.map(transformAgent);
    crewMembers.sort((a, b) => a.name.localeCompare(b.name));
    emitStatusChanges(crewMembers);
    return { success: true, data: crewMembers };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "AGENTS_ERROR",
        message: err instanceof Error ? err.message : "Failed to get agents",
      },
    };
  }
}
