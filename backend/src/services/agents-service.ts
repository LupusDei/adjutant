/**
 * Agents service for gastown-boy.
 *
 * Retrieves and transforms agent information into CrewMember format
 * for the dashboard display.
 */

import { gt } from "./gt-executor.js";
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
 * Raw agent data from gt status --json command.
 */
interface StatusAgent {
  name: string;
  address: string;
  role: string;
  running: boolean;
  state?: string;
  has_work?: boolean;
  unread_mail: number;
  first_subject?: string;
}

/**
 * Rig data from gt status --json command.
 */
interface StatusRig {
  name: string;
  agents: StatusAgent[];
  crews?: string[];
  polecats?: string[] | null;
}

/**
 * Full status response from gt status --json.
 */
interface StatusResponse {
  name: string;
  agents: StatusAgent[];
  rigs: StatusRig[];
}

/**
 * Raw agent data from gt agents list --all output.
 */
interface ListAgent {
  name: string;
  type: string;
  rig: string | null;
  running: boolean;
  state: string;
  unreadMail: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

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

/**
 * Extracts rig name from agent address.
 * e.g., "gastown/crew/carl" -> "gastown", "mayor/" -> null
 */
function extractRig(address: string): string | null {
  // Address format: "rigname/role" or "rigname/crew/name" or "mayor/"
  const parts = address.split("/");
  const rigName = parts[0];
  if (rigName && parts.length >= 2 && rigName !== "mayor" && rigName !== "deacon") {
    return rigName;
  }
  return null;
}

/**
 * Transforms status agent data to CrewMember format.
 */
function transformStatusAgent(agent: StatusAgent): CrewMember {
  const rig = extractRig(agent.address);
  const result: CrewMember = {
    id: agent.address,
    name: agent.name,
    type: mapAgentType(agent.role),
    rig,
    status: mapStatus(agent.running, agent.state),
    unreadMail: agent.unread_mail,
  };
  if (agent.first_subject) {
    result.currentTask = agent.first_subject;
  }
  return result;
}

/**
 * Transforms agents list output into CrewMember format.
 */
function transformListAgent(agent: ListAgent): CrewMember {
  const nameParts = agent.name.split("/");
  const displayName = nameParts[nameParts.length - 1] || agent.name;
  const address = agent.rig ? `${agent.rig}/${agent.name}` : `${agent.name}/`;

  return {
    id: address,
    name: displayName,
    type: mapAgentType(agent.type),
    rig: agent.rig ?? null,
    status: mapStatus(agent.running, agent.state),
    unreadMail: agent.unreadMail,
  };
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Gets all agents as CrewMember list for the dashboard.
 * Uses gt status --json which includes mail counts.
 */
export async function getAgents(): Promise<AgentsServiceResult<CrewMember[]>> {
  const result = await gt.status<StatusResponse>({ timeout: 10000 });

  if (!result.success) {
    const fallback = await gt.agents.list<ListAgent[]>({ timeout: 5000 });
    if (!fallback.success) {
      return {
        success: false,
        error: {
          code: fallback.error?.code ?? result.error?.code ?? "AGENTS_ERROR",
          message:
            fallback.error?.message ?? result.error?.message ?? "Failed to get status",
        },
      };
    }

    const crewMembers = (fallback.data ?? []).map(transformListAgent);
    crewMembers.sort((a, b) => a.name.localeCompare(b.name));
    return { success: true, data: crewMembers };
  }

  // Handle case where data might be undefined
  if (!result.data) {
    return {
      success: true,
      data: [],
    };
  }

  const allAgents: StatusAgent[] = [];

  // Add top-level agents (mayor, deacon)
  if (result.data.agents && Array.isArray(result.data.agents)) {
    allAgents.push(...result.data.agents);
  }

  // Add agents from each rig
  if (result.data.rigs && Array.isArray(result.data.rigs)) {
    for (const rig of result.data.rigs) {
      if (rig.agents && Array.isArray(rig.agents)) {
        allAgents.push(...rig.agents);
      }
    }
  }

  const crewMembers = allAgents.map(transformStatusAgent);

  // Sort alphabetically by name
  crewMembers.sort((a, b) => a.name.localeCompare(b.name));

  return { success: true, data: crewMembers };
}
