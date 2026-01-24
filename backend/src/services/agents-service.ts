/**
 * Agents service for Adjutant.
 *
 * Retrieves and transforms agent information into CrewMember format
 * for the dashboard display using bd/tmux data.
 */

import { collectAgentSnapshot, type AgentRuntimeInfo } from "./agent-data.js";
import { resolveTownRoot } from "./gastown-workspace.js";
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
 * Maps raw agent role string to AgentType enum.
 * Handles both direct type names and role aliases from gt status.
 */
function mapAgentType(role: string): AgentType {
  const typeMap: Record<string, AgentType> = {
    // Direct type names
    mayor: "mayor",
    deacon: "deacon",
    witness: "witness",
    refinery: "refinery",
    crew: "crew",
    polecat: "polecat",
    // Role aliases from gt status --json
    coordinator: "mayor",
    "health-check": "deacon",
  };
  return typeMap[role.toLowerCase()] ?? "crew";
}

/**
 * Maps raw state string to CrewMemberStatus.
 */
function mapStatus(running: boolean, state?: string): CrewMemberStatus {
  if (!running) return "offline";
  if (!state) return "idle";

  const stateMap: Record<string, CrewMemberStatus> = {
    idle: "idle",
    working: "working",
    blocked: "blocked",
    stuck: "stuck",
    "awaiting-gate": "blocked",
  };
  return stateMap[state.toLowerCase()] ?? "idle";
}

function transformAgent(agent: AgentRuntimeInfo): CrewMember {
  const result: CrewMember = {
    id: agent.address,
    name: agent.name,
    type: mapAgentType(agent.role),
    rig: agent.rig,
    status: mapStatus(agent.running, agent.state),
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
// Service Functions
// ============================================================================

/**
 * Gets all agents as CrewMember list for the dashboard.
 * Uses gt status --json which includes mail counts.
 */
export async function getAgents(): Promise<AgentsServiceResult<CrewMember[]>> {
  try {
    const townRoot = resolveTownRoot();
    const { agents } = await collectAgentSnapshot(townRoot);
    const crewMembers = agents.map(transformAgent);
    crewMembers.sort((a, b) => a.name.localeCompare(b.name));
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
