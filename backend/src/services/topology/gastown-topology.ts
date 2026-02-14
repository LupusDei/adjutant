/**
 * GasTownTopology - TopologyProvider implementation for Gas Town deployments.
 *
 * Implements the full Gas Town agent hierarchy:
 * - Infrastructure: mayor (coordinator), deacon (health check)
 * - Workers: witness, refinery, crew, polecat
 */

import type { AgentType } from "../../types/index.js";
import type {
  TopologyProvider,
  AgentAddress,
  SessionInfo,
} from "./topology-provider.js";

/**
 * Role aliases for normalization.
 * Maps various role strings to canonical AgentType values.
 */
const ROLE_ALIASES: Record<string, AgentType> = {
  // Mayor aliases
  coordinator: "mayor",
  "mayor/": "mayor",
  hq: "mayor",

  // Deacon aliases
  "health-check": "deacon",
  healthcheck: "deacon",
  "deacon/": "deacon",

  // Worker aliases
  worker: "polecat",
  polecats: "polecat",
};

/**
 * Known Gas Town roles.
 */
const GASTOWN_ROLES: AgentType[] = [
  "mayor",
  "deacon",
  "witness",
  "refinery",
  "crew",
  "polecat",
];

/**
 * Infrastructure roles (coordinator + health check).
 */
const INFRASTRUCTURE_ROLES: AgentType[] = ["mayor", "deacon"];

/**
 * Worker roles.
 */
const WORKER_ROLES: AgentType[] = ["witness", "refinery", "crew", "polecat"];

/**
 * Display names for agent types.
 */
const DISPLAY_NAMES: Record<string, string> = {
  mayor: "Mayor",
  deacon: "Deacon",
  witness: "Witness",
  refinery: "Refinery",
  crew: "Crew",
  polecat: "Polecat",
};

/**
 * TopologyProvider implementation for full Gas Town deployments.
 */
export class GasTownTopology implements TopologyProvider {
  readonly name = "gastown";

  agentTypes(): AgentType[] {
    return [...GASTOWN_ROLES];
  }

  coordinatorType(): AgentType {
    return "mayor";
  }

  infrastructureTypes(): AgentType[] {
    return [...INFRASTRUCTURE_ROLES];
  }

  workerTypes(): AgentType[] {
    return [...WORKER_ROLES];
  }

  normalizeRole(role: string): AgentType {
    const lower = role.toLowerCase().trim();

    // Check aliases first
    const alias = ROLE_ALIASES[lower];
    if (alias) return alias;

    // Check if it's a known role
    if (GASTOWN_ROLES.includes(lower as AgentType)) {
      return lower as AgentType;
    }

    // Return as-is (for custom/unknown roles)
    return lower as AgentType;
  }

  parseAddress(address: string): AgentAddress | null {
    if (!address) return null;

    // Handle special cases
    if (address === "overseer") {
      return { address: "overseer", role: "user", rig: null, name: null };
    }
    if (address === "mayor" || address === "mayor/") {
      return { address: "mayor/", role: "mayor", rig: null, name: null };
    }
    if (address === "deacon" || address === "deacon/") {
      return { address: "deacon/", role: "deacon", rig: null, name: null };
    }

    // Normalize: remove trailing slash
    let normalized = address;
    if (normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }

    const parts = normalized.split("/");

    // Single part: infrastructure role
    if (parts.length === 1 && parts[0]) {
      const role = this.normalizeRole(parts[0]);
      return { address, role, rig: null, name: null };
    }

    // Two parts: rig/role or role/name
    if (parts.length === 2 && parts[0] && parts[1]) {
      const first = parts[0];
      const second = parts[1];

      // Check if first is a known role
      if (GASTOWN_ROLES.includes(first.toLowerCase() as AgentType)) {
        return {
          address,
          role: this.normalizeRole(first),
          rig: null,
          name: second,
        };
      }

      // Otherwise, first is rig, second is role
      return {
        address,
        role: this.normalizeRole(second),
        rig: first,
        name: null,
      };
    }

    // Three parts: rig/role/name or rig/polecats/name
    if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
      const rig = parts[0];
      const middle = parts[1];
      const last = parts[2];

      // Handle rig/polecats/name or rig/crew/name format
      if (middle === "polecats" || middle === "polecat") {
        return { address, role: "polecat", rig, name: last };
      }
      if (middle === "crew") {
        return { address, role: "crew", rig, name: last };
      }

      // Otherwise: rig/role/name
      return {
        address,
        role: this.normalizeRole(middle),
        rig,
        name: last,
      };
    }

    // More than 3 parts: rig/role/name-with-dashes
    if (parts.length > 3 && parts[0] && parts[1]) {
      const rig = parts[0];
      const middle = parts[1];
      const name = parts.slice(2).join("/");

      if (middle === "polecats" || middle === "polecat") {
        return { address, role: "polecat", rig, name };
      }
      if (middle === "crew") {
        return { address, role: "crew", rig, name };
      }

      return {
        address,
        role: this.normalizeRole(middle),
        rig,
        name,
      };
    }

    return null;
  }

  buildAddress(role: AgentType, rig: string | null, name: string | null): string | null {
    const normalizedRole = this.normalizeRole(role);

    switch (normalizedRole) {
      case "mayor":
        return "mayor/";
      case "deacon":
        return "deacon/";
      case "witness":
        return rig ? `${rig}/witness` : null;
      case "refinery":
        return rig ? `${rig}/refinery` : null;
      case "crew":
        return rig && name ? `${rig}/crew/${name}` : null;
      case "polecat":
        return rig && name ? `${rig}/polecats/${name}` : null;
      default:
        // Custom role
        if (rig && name) return `${rig}/${normalizedRole}/${name}`;
        if (rig) return `${rig}/${normalizedRole}`;
        return `${normalizedRole}/`;
    }
  }

  getSessionInfo(role: AgentType, rig: string | null, name: string | null): SessionInfo | null {
    const normalizedRole = this.normalizeRole(role);

    switch (normalizedRole) {
      case "mayor":
        return { name: "hq-mayor", isInfrastructure: true };
      case "deacon":
        return { name: "hq-deacon", isInfrastructure: true };
      case "witness":
        return rig ? { name: `gt-${rig}-witness`, isInfrastructure: false } : null;
      case "refinery":
        return rig ? { name: `gt-${rig}-refinery`, isInfrastructure: false } : null;
      case "crew":
        return rig && name ? { name: `gt-${rig}-crew-${name}`, isInfrastructure: false } : null;
      case "polecat":
        return rig && name ? { name: `gt-${rig}-${name}`, isInfrastructure: false } : null;
      default:
        return null;
    }
  }

  isInfrastructure(role: AgentType): boolean {
    const normalizedRole = this.normalizeRole(role);
    return INFRASTRUCTURE_ROLES.includes(normalizedRole);
  }

  getDisplayName(role: AgentType): string {
    const normalizedRole = this.normalizeRole(role);
    return DISPLAY_NAMES[normalizedRole] ?? role.charAt(0).toUpperCase() + role.slice(1);
  }
}
