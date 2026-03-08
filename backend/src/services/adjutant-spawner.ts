/**
 * Adjutant Spawner — creates and checks the Adjutant coordinator agent session.
 *
 * Provides two modular functions:
 * - `spawnAdjutant()`: Idempotently spawns the Adjutant agent in a tmux session
 * - `isAdjutantAlive()`: Checks if the Adjutant agent's tmux session exists
 *
 * Designed for reuse by the scheduler's health check (Phase 3: `ensureAdjutantAlive`).
 */

import { logInfo, logWarn } from "../utils/index.js";
import { getSessionBridge } from "./session-bridge.js";
import { listTmuxSessions } from "./tmux.js";

// ============================================================================
// Constants
// ============================================================================

const ADJUTANT_SESSION_NAME = "adjutant";
const ADJUTANT_TMUX_SESSION = `adj-swarm-${ADJUTANT_SESSION_NAME}`;

// ============================================================================
// Public API
// ============================================================================

/**
 * Spawn the Adjutant coordinator agent in a tmux session.
 *
 * Idempotent: if the session already exists, logs and returns without error.
 * Never throws — all errors are caught and logged.
 */
export async function spawnAdjutant(projectPath: string): Promise<void> {
  try {
    // Check if session already exists
    let sessions: Set<string>;
    try {
      sessions = await listTmuxSessions();
    } catch {
      // tmux not running or unavailable — proceed with spawn attempt
      sessions = new Set();
    }

    if (sessions.has(ADJUTANT_TMUX_SESSION)) {
      logInfo("Adjutant session already exists, skipping spawn");
      return;
    }

    // Spawn via LifecycleManager
    const bridge = getSessionBridge();
    const result = await bridge.lifecycle.createSession({
      name: ADJUTANT_SESSION_NAME,
      projectPath,
      mode: "swarm",
    });

    if (result.success) {
      logInfo("Adjutant coordinator agent spawned", {
        sessionId: result.sessionId,
      });
    } else {
      logWarn("Adjutant spawn failed", { error: result.error });
    }
  } catch (err) {
    logWarn("Adjutant spawn error", { error: String(err) });
  }
}

/**
 * Check if the Adjutant coordinator agent's tmux session is alive.
 *
 * Returns false on any error (tmux not running, etc.).
 * Designed for reuse by health-check and recovery logic.
 */
export async function isAdjutantAlive(): Promise<boolean> {
  try {
    const sessions = await listTmuxSessions();
    return sessions.has(ADJUTANT_TMUX_SESSION);
  } catch {
    return false;
  }
}
