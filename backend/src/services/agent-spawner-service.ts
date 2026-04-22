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

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { logInfo, logWarn } from "../utils/index.js";
import { getEventBus } from "./event-bus.js";
import { getSessionBridge } from "./session-bridge.js";
import type { SessionMode } from "./session-registry.js";
import { listTmuxSessions } from "./tmux.js";
import { getPersonaService } from "./persona-service.js";
import { buildGenesisPrompt, extractLoreExcerpt } from "./adjutant/genesis-prompt.js";

// ============================================================================
// Spawn Health Check
// ============================================================================

/** How long to wait for an agent to connect via MCP after spawn */
export const SPAWN_HEALTH_CHECK_DELAY_MS = 30_000;

/** Pending health check timers keyed by agent name */
const pendingHealthChecks = new Map<string, NodeJS.Timeout>();

/**
 * Cancel a pending spawn health check for an agent.
 * Returns true if a timer was found and cancelled, false otherwise.
 */
export function cancelSpawnHealthCheck(agentName: string): boolean {
  const timer = pendingHealthChecks.get(agentName);
  if (timer) {
    clearTimeout(timer);
    pendingHealthChecks.delete(agentName);
    logInfo("Spawn health check cancelled — agent connected", { name: agentName });
    return true;
  }
  return false;
}

/**
 * Get the number of pending health checks (for diagnostics).
 */
export function pendingHealthCheckCount(): number {
  return pendingHealthChecks.size;
}

/**
 * Wire MCP agent_connected events to cancel pending spawn health checks.
 * Call this once during server initialization.
 */
export function wireSpawnHealthChecks(): void {
  getEventBus().on("mcp:agent_connected", (data) => {
    cancelSpawnHealthCheck(data.agentId);
  });
}

// ============================================================================
// Constitution Injection
// ============================================================================

/** Label prepended to constitution content when injected into agent prompts. */
export const CONSTITUTION_LABEL =
  "## Project Constitution (MANDATORY — obey every rule, reject work that violates any rule)";

/**
 * Read a project's constitution.md file.
 *
 * Returns the raw file content, or undefined if the file does not exist.
 * Other I/O errors (permission denied, etc.) are logged and treated as missing.
 */
export async function readProjectConstitution(
  projectPath: string,
): Promise<string | undefined> {
  try {
    const content = await readFile(
      join(projectPath, "constitution.md"),
      "utf-8",
    );
    return content.trim() || undefined;
  } catch {
    // Missing file or unreadable — proceed without constitution
    return undefined;
  }
}

/**
 * Format constitution content as a labeled prompt section.
 *
 * Returns a markdown block suitable for injection into an agent's prompt,
 * or undefined if no constitution text is provided.
 */
export function formatConstitutionPrompt(
  constitutionText: string | undefined,
): string | undefined {
  if (!constitutionText) return undefined;
  return `${CONSTITUTION_LABEL}\n\n${constitutionText}`;
}

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
  /** Additional environment variables to set in the tmux session before starting Claude */
  envVars?: Record<string, string>;
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

      // Re-export env vars to the existing session. Env vars (especially
      // ADJUTANT_PERSONA_ID) are only set during initial creation — if the
      // backend restarted, the shell env may be stale. Re-export any
      // caller-provided vars, and resolve persona if not already provided.
      const envVars: Record<string, string> = { ...req.envVars };
      const personaKey = "ADJUTANT_PERSONA_ID";
      if (!envVars[personaKey]) {
        const personaService = getPersonaService();
        if (personaService) {
          const persona = personaService.getPersonaByCallsign(req.name);
          if (persona) {
            envVars[personaKey] = persona.id;
          }
        }
      }
      if (Object.keys(envVars).length > 0) {
        await bridge.lifecycle.exportEnvVars(tmuxSession, envVars);
      }

      logInfo("Agent session already exists, skipping spawn", {
        name: req.name,
      });
      return { success: true, tmuxSession };
    }

    // Constitution injection (adj-160): Read project constitution and inject
    // into the effective prompt so every agent receives project-specific rules.
    const constitutionText = await readProjectConstitution(req.projectPath);
    const constitutionPrompt = formatConstitutionPrompt(constitutionText);

    // Living Personas (adj-158.2.3): If the callsign has no linked persona
    // and no agent file is specified, prepend a genesis prompt so the agent
    // creates its persona before starting work.
    let effectivePrompt = req.initialPrompt;
    if (!req.agentFile) {
      const personaService = getPersonaService();
      if (personaService) {
        const existingPersona = personaService.getPersonaByCallsign(req.name);
        if (!existingPersona) {
          const loreExcerpt = extractLoreExcerpt(req.name);
          const genesisPrompt = buildGenesisPrompt(
            req.name,
            loreExcerpt,
            req.initialPrompt,
          );
          // Genesis prompt goes BEFORE any task-specific prompt
          effectivePrompt = req.initialPrompt
            ? `${genesisPrompt}\n\n---\n\n${req.initialPrompt}`
            : genesisPrompt;
          logInfo("Injecting genesis prompt for persona-less callsign", { name: req.name });
        }
      }
    }

    // Prepend constitution to the effective prompt (before persona/genesis/task content)
    if (constitutionPrompt) {
      effectivePrompt = effectivePrompt
        ? `${constitutionPrompt}\n\n---\n\n${effectivePrompt}`
        : constitutionPrompt;
      logInfo("Injecting project constitution into spawn prompt", { name: req.name });
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
      ...(effectivePrompt ? { initialPrompt: effectivePrompt } : {}),
      ...(req.envVars ? { envVars: req.envVars } : {}),
    });

    if (result.success) {
      logInfo("Agent spawned", {
        name: req.name,
        sessionId: result.sessionId,
      });

      // Cancel any existing health check for this agent (prevents orphan timers
      // if spawnAgent is called twice for the same name before the first expires)
      cancelSpawnHealthCheck(req.name);

      // Schedule health check — verify agent connects via MCP within timeout
      const timer = setTimeout(() => {
        pendingHealthChecks.delete(req.name);
        getEventBus().emit("agent:spawn_failed", {
          agentId: req.name,
          reason: "no_mcp_connect",
          tmuxSession,
        });
        logWarn("Spawn health check failed — agent did not connect via MCP", {
          name: req.name,
          tmuxSession,
        });
      }, SPAWN_HEALTH_CHECK_DELAY_MS);
      // Don't block Node.js exit on this timer
      timer.unref();
      pendingHealthChecks.set(req.name, timer);

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
