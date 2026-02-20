/**
 * SwarmTopology - TopologyProvider implementation for swarm deployments.
 *
 * Implements a simple two-role model:
 * - user: The human operator (coordinator)
 * - agent: AI assistant agents
 */

import type { AgentType } from "../../types/index.js";
import type {
  TopologyProvider,
  AgentAddress,
  SessionInfo,
} from "./topology-provider.js";

/**
 * Role aliases for normalization.
 */
const ROLE_ALIASES: Record<string, AgentType> = {
  // User aliases
  human: "user",
  operator: "user",
  overseer: "user",

  // Agent aliases
  assistant: "agent",
  claude: "agent",
  ai: "agent",
};

/**
 * Known swarm roles.
 */
const SWARM_ROLES: AgentType[] = ["user", "agent"];

/**
 * Display names for agent types.
 */
const DISPLAY_NAMES: Record<string, string> = {
  user: "User",
  agent: "Agent",
};

/**
 * TopologyProvider implementation for swarm deployments.
 *
 * In swarm mode:
 * - There's one "user" (the human operator)
 * - There can be multiple "agent" instances
 * - No rig hierarchy - all agents are at the same level
 * - Session names are simple: "user" or "agent-{name}"
 */
export class SwarmTopology implements TopologyProvider {
  readonly name = "swarm";

  agentTypes(): AgentType[] {
    return [...SWARM_ROLES];
  }

  coordinatorType(): AgentType {
    return "user";
  }

  infrastructureTypes(): AgentType[] {
    // In swarm mode, only the user is "infrastructure"
    return ["user"];
  }

  workerTypes(): AgentType[] {
    return ["agent"];
  }

  normalizeRole(role: string): AgentType {
    const lower = role.toLowerCase().trim();

    // Check aliases first
    const alias = ROLE_ALIASES[lower];
    if (alias) return alias;

    // Check if it's a known role
    if (SWARM_ROLES.includes(lower as AgentType)) {
      return lower as AgentType;
    }

    // Return as-is (for custom/unknown roles)
    return lower as AgentType;
  }

  parseAddress(address: string): AgentAddress | null {
    if (!address) return null;

    // Handle special case: user
    if (address === "user" || address === "user/") {
      return { address: "user", role: "user", rig: null, name: null };
    }

    // Normalize: remove trailing slash
    let normalized = address;
    if (normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }

    const parts = normalized.split("/");

    // Single part: could be "user" or "agent" or agent name
    if (parts.length === 1 && parts[0]) {
      const part = parts[0];
      const role = this.normalizeRole(part);

      // If it normalizes to a known role, use it
      if (SWARM_ROLES.includes(role)) {
        return { address, role, rig: null, name: null };
      }

      // Otherwise, assume it's an agent name
      return { address, role: "agent", rig: null, name: part };
    }

    // Two parts: "agent/{name}" format
    if (parts.length === 2 && parts[0] && parts[1]) {
      const first = parts[0];
      const second = parts[1];

      const role = this.normalizeRole(first);
      if (role === "agent") {
        return { address, role: "agent", rig: null, name: second };
      }

      // Unknown format - treat first as role, second as name
      return { address, role: this.normalizeRole(first), rig: null, name: second };
    }

    // More parts - just use first as role, rest as name
    if (parts.length > 2 && parts[0]) {
      const role = this.normalizeRole(parts[0]);
      const name = parts.slice(1).join("/");
      return { address, role, rig: null, name };
    }

    return null;
  }

  buildAddress(role: AgentType, _rig: string | null, name: string | null): string | null {
    const normalizedRole = this.normalizeRole(role);

    switch (normalizedRole) {
      case "user":
        return "user";
      case "agent":
        return name ? `agent/${name}` : "agent";
      default:
        // Custom role
        return name ? `${normalizedRole}/${name}` : normalizedRole;
    }
  }

  getSessionInfo(role: AgentType, _rig: string | null, name: string | null): SessionInfo | null {
    const normalizedRole = this.normalizeRole(role);

    switch (normalizedRole) {
      case "user":
        return { name: "user", isInfrastructure: true };
      case "agent":
        return name
          ? { name: `agent-${name}`, isInfrastructure: false }
          : { name: "agent", isInfrastructure: false };
      default:
        return null;
    }
  }

  isInfrastructure(role: AgentType): boolean {
    const normalizedRole = this.normalizeRole(role);
    return normalizedRole === "user";
  }

  getDisplayName(role: AgentType): string {
    const normalizedRole = this.normalizeRole(role);
    return DISPLAY_NAMES[normalizedRole] ?? role.charAt(0).toUpperCase() + role.slice(1);
  }
}
