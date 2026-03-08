/**
 * Agent Spawner Service — generic agent spawning via tmux + Claude Code.
 *
 * Provides a generalized interface for spawning arbitrary Claude Code agents
 * in tmux sessions. The adjutant-spawner module wraps this for the specific
 * case of the Adjutant coordinator agent.
 *
 * Key behaviors:
 * - Idempotent: if a tmux session already exists, re-registers it if needed
 * - Never throws: all errors are caught and returned in the result
 * - Computes tmux session names via `getAgentTmuxSession()`
 */

import { logInfo, logWarn } from "../utils/index.js";
import { getSessionBridge } from "./session-bridge.js";
import { listTmuxSessions } from "./tmux.js";

// ============================================================================
// Types
// ============================================================================

export interface SpawnAgentRequest {
  /** Unique agent name (used to derive tmux session name). */
  name: string;
  /** Project root path. */
  projectPath: string;
  /** Optional agent file to pass via --agent flag. */
  agentFile?: string;
  /** Session mode (default: "swarm"). */
  mode?: "swarm";
  /** Extra Claude CLI args appended after --agent (if any). */
  claudeArgs?: string[];
  /** Optional initial prompt to send to the agent. */
  initialPrompt?: string;
}

export interface SpawnAgentResult {
  success: boolean;
  sessionId?: string;
  tmuxSession?: string;
  error?: string;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Compute the tmux session name for a given agent name.
 */
export function getAgentTmuxSession(name: string): string {
  return `adj-swarm-${name}`;
}

/**
 * Spawn an agent in a tmux session via the SessionBridge.
 *
 * Idempotent: if the tmux session already exists, re-registers it in the
 * registry (if needed) and returns success. Never throws.
 */
export async function spawnAgent(
  req: SpawnAgentRequest
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
        const rediscovered =
          bridge.registry.findByTmuxSession(tmuxSession);
        if (rediscovered) {
          rediscovered.name = req.name;
          rediscovered.projectPath = req.projectPath;
        }
        await bridge.registry.save();
        logInfo("Re-registered orphaned agent session", {
          name: req.name,
          tmuxSession,
        });
      }
      logInfo("Agent session already exists, skipping spawn", {
        name: req.name,
        tmuxSession,
      });
      return { success: true, tmuxSession };
    }

    // Build claudeArgs: --agent <file> if provided, then merge extra args
    const claudeArgs: string[] = [];
    if (req.agentFile) {
      claudeArgs.push("--agent", req.agentFile);
    }
    if (req.claudeArgs) {
      claudeArgs.push(...req.claudeArgs);
    }

    // Spawn via SessionBridge (persists registry to disk)
    const result = await bridge.createSession({
      name: req.name,
      projectPath: req.projectPath,
      mode: req.mode ?? "swarm",
      claudeArgs: claudeArgs.length > 0 ? claudeArgs : undefined,
    });

    if (result.success) {
      logInfo("Agent spawned", {
        name: req.name,
        sessionId: result.sessionId,
        tmuxSession,
      });
      return {
        success: true,
        ...(result.sessionId ? { sessionId: result.sessionId } : {}),
        tmuxSession,
      };
    } else {
      logWarn("Agent spawn failed", {
        name: req.name,
        error: result.error,
      });
      return {
        success: false,
        ...(result.error ? { error: result.error } : {}),
        tmuxSession,
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
      tmuxSession,
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
