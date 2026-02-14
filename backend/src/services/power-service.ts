/**
 * Power service for Adjutant.
 *
 * Uses bd/tmux for read-side status and gt for up/down lifecycle control.
 */

import { basename, join } from "path";
import { collectAgentSnapshot, type AgentRuntimeInfo } from "./agent-data.js";
import { resolveWorkspaceRoot, loadWorkspaceConfig, listRigNames } from "./workspace/index.js";
import { execGtControl } from "./gt-control.js";
import { getEventBus } from "./event-bus.js";
import type { GastownStatus, PowerState, AgentStatus, RigStatus } from "../types/index.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Result type for power service operations.
 */
export interface PowerServiceResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Result data for power state transitions.
 */
export interface PowerTransitionResult {
  previousState: PowerState;
  newState: PowerState;
}

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
// Power Service Functions
// ============================================================================

/**
 * Gets the current gastown status.
 */
export async function getStatus(): Promise<PowerServiceResult<GastownStatus>> {
  try {
    const townRoot = resolveWorkspaceRoot();
    const townConfig = await loadWorkspaceConfig();
    const { agents, mailIndex } = await collectAgentSnapshot(townRoot, ["overseer"]);

    const mayor = agents.find((agent) => agent.role === "mayor");
    const deacon = agents.find((agent) => agent.role === "deacon");

    const rigNames = await listRigNames();
    const agentRigNames = new Set(agents.map((agent) => agent.rig).filter(Boolean) as string[]);
    const rigSet = new Set([...rigNames, ...agentRigNames]);

    const operatorMail = mailIndex.get("overseer");
    const townName = townConfig.name ?? basename(townRoot);

    const status: GastownStatus = {
      powerState: mayor?.running ? "running" : "stopped",
      town: {
        name: townName,
        root: townRoot,
      },
      operator: {
        name: townConfig.owner?.name ?? "Overseer",
        email: townConfig.owner?.email ?? "",
        unreadMail: operatorMail?.unread ?? 0,
      },
      infrastructure: {
        mayor: toAgentStatus(mayor, "mayor"),
        deacon: toAgentStatus(deacon, "deacon"),
        daemon: { ...DEFAULT_AGENT, name: "daemon" },
      },
      rigs: Array.from(rigSet).map((rig) => buildRigStatus(rig, townRoot, agents)),
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

/**
 * Starts gastown (power up).
 */
export async function powerUp(): Promise<PowerServiceResult<PowerTransitionResult>> {
  const statusResult = await getStatus();
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

  getEventBus().emit("power:state_changed", { state: "starting" });

  return {
    success: true,
    data: {
      previousState: currentState ?? "stopped",
      newState: "starting",
    },
  };
}

/**
 * Stops gastown (power down).
 */
export async function powerDown(): Promise<PowerServiceResult<PowerTransitionResult>> {
  const statusResult = await getStatus();
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

  getEventBus().emit("power:state_changed", { state: "stopping" });

  return {
    success: true,
    data: {
      previousState: currentState ?? "running",
      newState: "stopping",
    },
  };
}
