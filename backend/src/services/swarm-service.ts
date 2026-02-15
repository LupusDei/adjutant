/**
 * SwarmService — manages swarm creation and lifecycle.
 *
 * A swarm is N agents working on one project, each in their own worktree/branch.
 * One agent can be designated as the coordinator (merge agent).
 */

import { execFile } from "child_process";
import { logInfo, logWarn } from "../utils/index.js";
import { getSessionBridge, type SessionInfo } from "./session-bridge.js";

// ============================================================================
// Types
// ============================================================================

export interface SwarmConfig {
  projectPath: string;
  agentCount: number;
  workspaceType?: "worktree" | "copy";
  coordinatorIndex?: number; // Which agent (0-based) is the coordinator
  baseName?: string;
}

export interface SwarmInfo {
  id: string;
  projectPath: string;
  agents: SwarmAgent[];
  coordinator?: string; // Session ID of the coordinator
  createdAt: string;
}

export interface SwarmAgent {
  sessionId: string;
  name: string;
  branch: string;
  status: string;
  isCoordinator: boolean;
}

export interface CreateSwarmResult {
  success: boolean;
  swarm?: SwarmInfo;
  error?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function execCommand(
  cmd: string,
  args: string[],
  cwd?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "utf8", cwd }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
        return;
      }
      resolve(stdout);
    });
  });
}

// ============================================================================
// SwarmService
// ============================================================================

const swarms = new Map<string, SwarmInfo>();
let swarmCounter = 0;

/**
 * Create a swarm of N agents working on a project.
 */
export async function createSwarm(config: SwarmConfig): Promise<CreateSwarmResult> {
  const { projectPath, agentCount, workspaceType = "worktree", coordinatorIndex, baseName } = config;

  if (agentCount < 1 || agentCount > 20) {
    return { success: false, error: "Agent count must be between 1 and 20" };
  }

  const bridge = getSessionBridge();
  const swarmId = `swarm-${++swarmCounter}`;
  const base = baseName ?? `agent`;
  const agents: SwarmAgent[] = [];
  const errors: string[] = [];

  for (let i = 0; i < agentCount; i++) {
    const name = `${base}-${i + 1}`;
    const branch = `swarm/${swarmId}/${name}`;
    const isCoordinator = coordinatorIndex !== undefined && i === coordinatorIndex;

    // Create worktree if needed
    if (workspaceType === "worktree" && i > 0) {
      try {
        await execCommand("git", ["worktree", "add", "-b", branch, `worktrees/${name}`], projectPath);
      } catch (err) {
        errors.push(`Failed to create worktree for ${name}: ${err}`);
        continue;
      }
    }

    const sessionPath = workspaceType === "worktree" && i > 0
      ? `${projectPath}/worktrees/${name}`
      : projectPath;

    const result = await bridge.createSession({
      name,
      projectPath: sessionPath,
      mode: "swarm",
      workspaceType: i === 0 ? "primary" : workspaceType,
    });

    if (result.success && result.sessionId) {
      agents.push({
        sessionId: result.sessionId,
        name,
        branch: i === 0 ? "main" : branch,
        status: "working",
        isCoordinator,
      });
    } else {
      errors.push(`Failed to create agent ${name}: ${result.error}`);
    }
  }

  if (agents.length === 0) {
    return { success: false, error: `No agents created. Errors: ${errors.join("; ")}` };
  }

  const swarm: SwarmInfo = {
    id: swarmId,
    projectPath,
    agents,
    coordinator: agents.find((a) => a.isCoordinator)?.sessionId,
    createdAt: new Date().toISOString(),
  };

  swarms.set(swarmId, swarm);

  logInfo("Swarm created", {
    swarmId,
    agentCount: agents.length,
    coordinator: swarm.coordinator,
  });

  return { success: true, swarm };
}

/**
 * Add an agent to an existing swarm.
 */
export async function addAgentToSwarm(
  swarmId: string,
  name?: string
): Promise<{ success: boolean; agent?: SwarmAgent; error?: string }> {
  const swarm = swarms.get(swarmId);
  if (!swarm) {
    return { success: false, error: "Swarm not found" };
  }

  const agentName = name ?? `agent-${swarm.agents.length + 1}`;
  const branch = `swarm/${swarmId}/${agentName}`;
  const bridge = getSessionBridge();

  try {
    await execCommand(
      "git",
      ["worktree", "add", "-b", branch, `worktrees/${agentName}`],
      swarm.projectPath
    );
  } catch (err) {
    return { success: false, error: `Failed to create worktree: ${err}` };
  }

  const result = await bridge.createSession({
    name: agentName,
    projectPath: `${swarm.projectPath}/worktrees/${agentName}`,
    mode: "swarm",
    workspaceType: "worktree",
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  const agent: SwarmAgent = {
    sessionId: result.sessionId!,
    name: agentName,
    branch,
    status: "working",
    isCoordinator: false,
  };

  swarm.agents.push(agent);

  logInfo("Agent added to swarm", { swarmId, agent: agentName });
  return { success: true, agent };
}

/**
 * Remove an agent from a swarm.
 */
export async function removeAgentFromSwarm(
  swarmId: string,
  sessionId: string,
  removeWorktree = false
): Promise<boolean> {
  const swarm = swarms.get(swarmId);
  if (!swarm) return false;

  const agentIndex = swarm.agents.findIndex((a) => a.sessionId === sessionId);
  if (agentIndex === -1) return false;

  const agent = swarm.agents[agentIndex]!;
  const bridge = getSessionBridge();

  // Kill the session
  await bridge.killSession(sessionId);

  // Remove worktree if requested
  if (removeWorktree && agent.branch !== "main") {
    try {
      await execCommand(
        "git",
        ["worktree", "remove", `worktrees/${agent.name}`, "--force"],
        swarm.projectPath
      );
    } catch (err) {
      logWarn("Failed to remove worktree", { agent: agent.name, error: String(err) });
    }
  }

  swarm.agents.splice(agentIndex, 1);

  logInfo("Agent removed from swarm", { swarmId, agent: agent.name });
  return true;
}

/**
 * Get swarm status with live session info.
 */
export function getSwarmStatus(swarmId: string): SwarmInfo | undefined {
  const swarm = swarms.get(swarmId);
  if (!swarm) return undefined;

  // Update agent statuses from session bridge
  const bridge = getSessionBridge();
  for (const agent of swarm.agents) {
    const session = bridge.getSession(agent.sessionId);
    if (session) {
      agent.status = session.status;
    } else {
      agent.status = "offline";
    }
  }

  return swarm;
}

/**
 * List all swarms.
 */
export function listSwarms(): SwarmInfo[] {
  return Array.from(swarms.values());
}

/**
 * Kill all agents in a swarm and clean up.
 */
export async function destroySwarm(
  swarmId: string,
  removeWorktrees = true
): Promise<boolean> {
  const swarm = swarms.get(swarmId);
  if (!swarm) return false;

  for (const agent of [...swarm.agents]) {
    await removeAgentFromSwarm(swarmId, agent.sessionId, removeWorktrees);
  }

  swarms.delete(swarmId);
  logInfo("Swarm destroyed", { swarmId });
  return true;
}

/**
 * Reset swarm state (for testing).
 */
export function resetSwarmService(): void {
  swarms.clear();
  swarmCounter = 0;
}
