/**
 * Agent Spawner Service — generic agent spawning via tmux + SessionBridge.
 *
 * Provides a generalized interface for spawning any Claude Code agent
 * in a tmux session. Specific agents (e.g., Adjutant coordinator) should
 * use thin wrappers that delegate here.
 *
 * Public API:
 * - `spawnAgent()`: Idempotently spawn an agent in a tmux session
 * - `isAgentAlive()`: Check if an agent's tmux session exists
 * - `getAgentTmuxSession()`: Compute the tmux session name for an agent
 */

import { logInfo, logWarn } from "../utils/index.js";
import { getSessionBridge } from "./session-bridge.js";
import type { SessionMode } from "./session-registry.js";
import { listTmuxSessions } from "./tmux.js";

// ============================================================================
// Types
// ============================================================================

export interface SpawnAgentRequest {
  /** Human-readable agent name (used for tmux session naming) */
  name: string;
  /** Path to the project the agent works on */
  projectPath: string;
  /** Agent file to load (e.g., "adjutant") — passed as --agent flag */
  agentFile?: string;
  /** Session mode: "swarm" or "standalone" */
  mode?: "swarm" | "standalone";
  /** Additional Claude CLI args */
  claudeArgs?: string[];
  /** Optional initial prompt to send after spawn */
  initialPrompt?: string;
}

export interface SpawnAgentResult {
  success: boolean;
  sessionId?: string | undefined;
  tmuxSession?: string | undefined;
  error?: string | undefined;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Spawn a Claude Code agent in a tmux session.
 *
 * Idempotent: if a session with the same name already exists, re-registers
 * it if needed and returns without spawning a new one.
 * Never throws — all errors are caught and returned as { success: false, error }.
 */
export async function spawnAgent(
  req: SpawnAgentRequest,
): Promise<SpawnAgentResult> {
  const tmuxSession = getAgentTmuxSession(req.name);

  try {
    // Check if session already exists
    let sessions: Set<string>;
    try {
      sessions = await listTmuxSessions();
    } catch {
      // tmux not running or unavailable — proceed with spawn attempt
      sessions = new Set();
    }

    const bridge = getSessionBridge();

    if (sessions.has(tmuxSession)) {
      // Tmux session exists — ensure it's tracked in the registry so it
      // appears in the agents list. Without this, an orphaned session
      // (survived a backend restart) would be invisible to the dashboard.
      if (!bridge.registry.findByTmuxSession(tmuxSession)) {
        await bridge.lifecycle.discoverSessions(tmuxSession);
        // Fix metadata: discoverSessions uses the tmux name as fallback
        const rediscovered = bridge.registry.findByTmuxSession(tmuxSession);
        if (rediscovered) {
          rediscovered.name = req.name;
          rediscovered.projectPath = req.projectPath;
        }
        await bridge.registry.save();
        logInfo("Re-registered orphaned agent session", { name: req.name });
      }
      logInfo("Agent session already exists, skipping spawn", {
        name: req.name,
      });
      return { success: true, tmuxSession };
    }

    // Build claudeArgs
    const claudeArgs: string[] = [];
    if (req.agentFile) {
      claudeArgs.push("--agent", req.agentFile);
    }
    if (req.claudeArgs) {
      claudeArgs.push(...req.claudeArgs);
    }

    // Spawn via SessionBridge (persists registry to disk)
    // SessionMode is currently "swarm" only; default to "swarm" and pass through
    // Safe cast: we accept broader input but narrow to SessionMode for the bridge
    const mode = (req.mode ?? "swarm") as SessionMode;
    const result = await bridge.createSession({
      name: req.name,
      projectPath: req.projectPath,
      mode,
      ...(claudeArgs.length > 0 ? { claudeArgs } : {}),
    });

    if (result.success) {
      logInfo("Agent spawned", {
        name: req.name,
        sessionId: result.sessionId,
      });
      return {
        success: true,
        sessionId: result.sessionId,
        tmuxSession,
      };
    } else {
      logWarn("Agent spawn failed", {
        name: req.name,
        error: result.error,
      });
      return {
        success: false,
        error: result.error,
      };
    }
  } catch (err) {
    logWarn("Agent spawn error", {
      name: req.name,
      error: String(err),
    });
    return {
      success: false,
      error: String(err),
    };
  }
}

/**
 * Check if an agent's tmux session is alive.
 *
 * Returns false on any error (tmux not running, etc.).
 */
export async function isAgentAlive(name: string): Promise<boolean> {
  try {
    const sessions = await listTmuxSessions();
    return sessions.has(getAgentTmuxSession(name));
  } catch {
    return false;
  }
}

/**
 * Get the tmux session name for an agent.
 */
export function getAgentTmuxSession(name: string): string {
  return `adj-swarm-${name}`;
}
