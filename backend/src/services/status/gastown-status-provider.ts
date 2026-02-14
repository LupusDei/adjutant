/**
 * GasTownStatusProvider - StatusProvider implementation for Gas Town deployments.
 *
 * Provides full Gas Town infrastructure status including:
 * - Power state from mayor session status
 * - Infrastructure agents (mayor, deacon, daemon)
 * - Per-rig agent status (witness, refinery, crew, polecats)
 * - Power control via gt up/down
 */

import { basename, join } from "path";
import { collectAgentSnapshot, type AgentRuntimeInfo } from "../agent-data.js";
import { resolveWorkspaceRoot, loadWorkspaceConfig, listRigNames } from "../workspace/index.js";
import { execGtControl } from "../gt-control.js";
import { getAgents } from "../agents-service.js";
import type { PowerState, AgentStatus, RigStatus, CrewMember } from "../../types/index.js";
import type {
  StatusProvider,
  StatusResult,
  SystemStatus,
  PowerCapabilities,
  PowerTransitionResult,
} from "./status-provider.js";

// ============================================================================
// Helpers
// ============================================================================

const DEFAULT_AGENT: AgentStatus = {
  name: "unknown",
  running: false,
  unreadMail: 0,
};

function normalizeAgentState(state?: string): AgentStatus["state"] | undefined {
  if (!state) return undefined;
  const normalized = state.toLowerCase();
  if (normalized === "stuck" || normalized === "awaiting-gate") {
    return normalized as AgentStatus["state"];
  }
  if (normalized === "idle" || normalized === "working") {
    return normalized as AgentStatus["state"];
  }
  if (normalized === "blocked") {
    return "awaiting-gate";
  }
  return undefined;
}

function toAgentStatus(agent: AgentRuntimeInfo | undefined, fallbackName: string): AgentStatus {
  if (!agent) {
    return { ...DEFAULT_AGENT, name: fallbackName };
  }
  const status: AgentStatus = {
    name: agent.name,
    running: agent.running,
    unreadMail: agent.unreadMail,
  };
  if (agent.firstSubject) {
    status.firstMessageSubject = agent.firstSubject;
  }
  const state = normalizeAgentState(agent.state);
  if (state) {
    status.state = state;
  }
  return status;
}

function buildRigStatus(rigName: string, townRoot: string, agents: AgentRuntimeInfo[]): RigStatus {
  const rigAgents = agents.filter((agent) => agent.rig === rigName);
  const witness = rigAgents.find((agent) => agent.role === "witness");
  const refinery = rigAgents.find((agent) => agent.role === "refinery");
  const crew = rigAgents.filter((agent) => agent.role === "crew");
  const polecats = rigAgents.filter((agent) => agent.role === "polecat");

  return {
    name: rigName,
    path: join(townRoot, rigName),
    witness: toAgentStatus(witness, "witness"),
    refinery: toAgentStatus(refinery, "refinery"),
    crew: crew.map((agent) => toAgentStatus(agent, agent.name)),
    polecats: polecats.map((agent) => toAgentStatus(agent, agent.name)),
    mergeQueue: { pending: 0, inFlight: 0, blocked: 0 },
  };
}

// ============================================================================
// GasTownStatusProvider
// ============================================================================

/**
 * StatusProvider implementation for Gas Town deployments.
 */
export class GasTownStatusProvider implements StatusProvider {
  readonly name = "gastown";

  getPowerCapabilities(): PowerCapabilities {
    return {
      canControl: true,
      autoStart: false,
    };
  }

  hasPowerControl(): boolean {
    return true;
  }

  async getStatus(): Promise<StatusResult<SystemStatus>> {
    try {
      const townRoot = resolveWorkspaceRoot();
      const townConfig = await loadWorkspaceConfig();
      const { agents: rawAgents, mailIndex } = await collectAgentSnapshot(townRoot, ["overseer"]);

      const mayor = rawAgents.find((agent) => agent.role === "mayor");
      const deacon = rawAgents.find((agent) => agent.role === "deacon");

      const rigNames = await listRigNames();
      const agentRigNames = new Set(rawAgents.map((agent) => agent.rig).filter(Boolean) as string[]);
      const rigSet = new Set([...rigNames, ...agentRigNames]);

      const operatorMail = mailIndex.get("overseer");
      const townName = townConfig.name ?? basename(townRoot);

      // Get crew members for agents list
      const agentsResult = await getAgents();
      const crewMembers: CrewMember[] = agentsResult.success && agentsResult.data ? agentsResult.data : [];

      const status: SystemStatus = {
        powerState: mayor?.running ? "running" : "stopped",
        powerCapabilities: this.getPowerCapabilities(),
        workspace: {
          name: townName,
          root: townRoot,
        },
        operator: {
          name: townConfig.owner?.name ?? "Overseer",
          email: townConfig.owner?.email ?? "",
          unreadMail: operatorMail?.unread ?? 0,
        },
        infrastructure: {
          coordinator: toAgentStatus(mayor, "mayor"),
          healthCheck: toAgentStatus(deacon, "deacon"),
          daemon: { ...DEFAULT_AGENT, name: "daemon" },
        },
        rigs: Array.from(rigSet).map((rig) => buildRigStatus(rig, townRoot, rawAgents)),
        agents: crewMembers,
        fetchedAt: new Date().toISOString(),
      };

      return { success: true, data: status };
    } catch (err) {
      return {
        success: false,
        error: {
          code: "STATUS_ERROR",
          message: err instanceof Error ? err.message : "Failed to get gastown status",
        },
      };
    }
  }

  async powerUp(): Promise<StatusResult<PowerTransitionResult>> {
    const statusResult = await this.getStatus();
    const currentState: PowerState | undefined = statusResult.data?.powerState;

    if (currentState === "running") {
      return {
        success: false,
        error: {
          code: "ALREADY_RUNNING",
          message: "Gastown is already running",
        },
      };
    }

    const townRoot = resolveWorkspaceRoot();
    const upResult = await execGtControl(["up"], { cwd: townRoot });

    if (!upResult.success) {
      return {
        success: false,
        error: {
          code: upResult.error?.code ?? "STARTUP_FAILED",
          message: upResult.error?.message ?? "Failed to start gastown",
        },
      };
    }

    return {
      success: true,
      data: {
        previousState: currentState ?? "stopped",
        newState: "starting",
      },
    };
  }

  async powerDown(): Promise<StatusResult<PowerTransitionResult>> {
    const statusResult = await this.getStatus();
    const currentState: PowerState | undefined = statusResult.data?.powerState;

    if (currentState === "stopped") {
      return {
        success: false,
        error: {
          code: "ALREADY_STOPPED",
          message: "Gastown is already stopped",
        },
      };
    }

    const townRoot = resolveWorkspaceRoot();
    const downResult = await execGtControl(["down"], { cwd: townRoot });

    if (!downResult.success) {
      return {
        success: false,
        error: {
          code: downResult.error?.code ?? "SHUTDOWN_FAILED",
          message: downResult.error?.message ?? "Failed to stop gastown",
        },
      };
    }

    return {
      success: true,
      data: {
        previousState: currentState ?? "running",
        newState: "stopping",
      },
    };
  }
}
