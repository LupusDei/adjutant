/**
 * Adjutant Spawner — thin wrapper around agent-spawner-service for the
 * Adjutant coordinator agent.
 *
 * Provides three functions:
 * - `spawnAdjutant()`: Idempotently spawns the Adjutant agent in a tmux session
 * - `isAdjutantAlive()`: Checks if the Adjutant agent's tmux session exists
 * - `ensureAdjutantAlive()`: Health check with automatic recovery — respawns if dead
 */

import { logInfo, logWarn } from "../utils/index.js";
import {
  spawnAgent,
  isAgentAlive,
  getAgentTmuxSession,
} from "./agent-spawner-service.js";

// ============================================================================
// Constants
// ============================================================================

const ADJUTANT_SESSION_NAME = "adjutant-coordinator";
export const ADJUTANT_TMUX_SESSION = getAgentTmuxSession(ADJUTANT_SESSION_NAME);

// ============================================================================
// Public API
// ============================================================================

/**
 * Spawn the Adjutant coordinator agent in a tmux session.
 *
 * Delegates to the generic `spawnAgent()` with Adjutant-specific config.
 * Idempotent: if the session already exists, logs and returns without error.
 * Never throws — all errors are caught and logged.
 */
export async function spawnAdjutant(projectPath: string): Promise<void> {
  await spawnAgent({
    name: ADJUTANT_SESSION_NAME,
    projectPath,
    agentFile: "adjutant",
    mode: "swarm",
  });
}

/**
 * Check if the Adjutant coordinator agent's tmux session is alive.
 *
 * Returns false on any error (tmux not running, etc.).
 * Designed for reuse by health-check and recovery logic.
 */
export async function isAdjutantAlive(): Promise<boolean> {
  return isAgentAlive(ADJUTANT_SESSION_NAME);
}

/** Stabilization wait after recovery (ms) */
const RECOVERY_STABILIZATION_MS = 10_000;

/**
 * Ensure the Adjutant coordinator agent is alive, recovering it if dead.
 *
 * Composes `isAdjutantAlive()` and `spawnAdjutant()` into a single health-check
 * function suitable for use by the scheduler or any other caller.
 *
 * @param projectPath - Project root path to pass to `spawnAdjutant()`
 * @returns `true` if recovery was performed, `false` if already alive or on error
 */
export async function ensureAdjutantAlive(
  projectPath: string,
): Promise<boolean> {
  try {
    const alive = await isAdjutantAlive();
    if (alive) {
      return false;
    }

    // Dead — attempt recovery
    await spawnAdjutant(projectPath);

    // Wait for the agent to stabilize before returning
    await new Promise((resolve) =>
      setTimeout(resolve, RECOVERY_STABILIZATION_MS),
    );

    logInfo("Adjutant agent recovered", { projectPath });
    return true;
  } catch (err) {
    logWarn("Adjutant recovery failed", { error: String(err) });
    return false;
  }
}
