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
import { listTmuxSessions, getPaneCurrentCommand, isShellPaneCommand } from "./tmux.js";
import { listResumableSessions } from "./transcript-discovery.js";
import { getPersonaService } from "./persona-service.js";
import { provisionAgentWorktree, resolveWorktreeDoltEnv } from "./worktree-service.js";
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
  /**
   * Rendered persona prompt to inject directly into the spawn's initial prompt (adj-j0jpz).
   * This is the PRIMARY, project-agnostic delivery path: unlike the `--agent` file or the
   * SessionStart hook, a prompt injection needs nothing from the target project (no hook
   * registered, no on-disk agent file, no worktree cooperation), so a persona reaches the
   * agent's turn-1 context even when spawned into a non-adjutant repo. Callers that have a
   * linked persona pass its `generatePrompt(...)` output here; the on-disk agent file and
   * hook remain as the re-injection cache for surviving compaction.
   */
  personaPrompt?: string;
  /** Session mode: "swarm" or "standalone" */
  mode?: "swarm" | "standalone";
  /** Additional Claude CLI args */
  claudeArgs?: string[];
  /** Optional initial prompt to send after spawn */
  initialPrompt?: string;
  /** Additional environment variables to set in the tmux session before starting Claude */
  envVars?: Record<string, string>;
  /**
   * Workspace isolation (adj-182.5). "worktree" provisions a dedicated git worktree
   * and roots the agent there so its edits never touch the canonical checkout (which
   * the dev backend watches — see adj-8mmyd). "none" (default) runs in `projectPath`
   * as-is; used for the coordinator / system agents that manage from the main repo and
   * for read-only agents. Worker spawn paths (spawn_worker, REST teammate spawn) pass
   * "worktree".
   */
  isolation?: "worktree" | "none";
  /**
   * Resume the agent from an existing Claude Code transcript instead of starting it
   * cold (adj-dpgqc). The id comes from {@link listResumableSessions}.
   *
   * A resumed agent already carries its constitution, persona and mission in the
   * transcript, so NONE of those are re-injected — waking an agent to a wall of
   * boilerplate as its newest instruction is how you lose the thread it was on.
   */
  resumeSessionId?: string;
  /**
   * Short note delivered once the resumed agent is responsive — the one thing the
   * transcript cannot contain, namely what happened while it was dead
   * ("the host rebooted at 20:54; your worktree is intact"). Without it the agent
   * resumes mid-thought with no idea time has passed.
   */
  resumeNote?: string;
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
 * Is this pane sitting at a shell prompt (safe to type into)? (adj-c55l3)
 *
 * Fails CLOSED: if the pane command cannot be read we answer "no". Typing blind into
 * a pane that might be a live agent is the failure this guard exists to prevent, and
 * the cost of a wrong "no" is only a skipped env re-export.
 */
async function paneIsAtShellPrompt(tmuxSession: string): Promise<boolean> {
  try {
    const command = await getPaneCurrentCommand(tmuxSession);
    return isShellPaneCommand(command);
  } catch (err) {
    logWarn("Could not read pane command — treating pane as busy (adj-c55l3)", {
      tmuxSession,
      error: String(err),
    });
    return false;
  }
}

/**
 * Schedule the post-spawn MCP connect check. Shared by the spawn and resume paths:
 * a resumed agent that never reconnects is just as dead as one that never started.
 */
function scheduleSpawnHealthCheck(name: string, tmuxSession: string): void {
  // Cancel any existing health check for this agent (prevents orphan timers
  // if spawnAgent is called twice for the same name before the first expires)
  cancelSpawnHealthCheck(name);

  const timer = setTimeout(() => {
    pendingHealthChecks.delete(name);
    getEventBus().emit("agent:spawn_failed", {
      agentId: name,
      reason: "no_mcp_connect",
      tmuxSession,
    });
    logWarn("Spawn health check failed — agent did not connect via MCP", {
      name,
      tmuxSession,
    });
  }, SPAWN_HEALTH_CHECK_DELAY_MS);
  // Don't block Node.js exit on this timer
  timer.unref();
  pendingHealthChecks.set(name, timer);
}

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
      // adj-dpgqc: a resume must never run against a live pane. Adoption is the right
      // move for an agent that is already up; resuming would start a SECOND claude on
      // the same transcript and the two would fight over the same worktree.
      if (req.resumeSessionId) {
        logWarn("Refusing to resume — tmux session already running", {
          name: req.name,
          tmuxSession,
        });
        return {
          success: false,
          error:
            `Agent '${req.name}' is already running in tmux session '${tmuxSession}'. ` +
            `Kill it first if you really want to resume from a transcript.`,
          tmuxSession,
        };
      }

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
      // adj-c55l3: only a pane sitting at a SHELL prompt may be typed into.
      // exportEnvVars uses `send-keys "export K=V" Enter`; against a running Claude
      // Code TUI that is not a shell command at all — it is typed into Claude's input
      // box and submitted, costing the agent a turn and polluting its transcript
      // (observed twice on 2026-09-17). A running process cannot pick up a new env var
      // anyway, so the exports would be dead weight even if they landed cleanly.
      if (Object.keys(envVars).length > 0) {
        const paneIsShell = await paneIsAtShellPrompt(tmuxSession);
        if (paneIsShell) {
          await bridge.lifecycle.exportEnvVars(tmuxSession, envVars);
        } else {
          logInfo("Skipping env re-export — pane is not at a shell prompt (adj-c55l3)", {
            name: req.name,
            tmuxSession,
          });
        }
      }

      logInfo("Agent session already exists, skipping spawn", {
        name: req.name,
      });
      return { success: true, tmuxSession };
    }

    // Workspace isolation (adj-182.5): when requested, provision a dedicated git
    // worktree and root the agent there so its file edits never touch the canonical
    // checkout the dev backend watches (adj-8mmyd). Fail-open: if provisioning fails
    // we fall back to the canonical path (with a warn) rather than block the spawn.
    let effectiveProjectPath = req.projectPath;
    const isolationEnv: Record<string, string> = {};
    if (req.isolation === "worktree") {
      const worktreePath = await provisionAgentWorktree(req.projectPath, req.name);
      if (worktreePath) {
        effectiveProjectPath = worktreePath;
        logInfo("Spawning agent in isolated worktree", { name: req.name, worktree: worktreePath });
        // adj-182.3.1: point the worktree agent at the SUPERVISED server (pinned port)
        // and assert it has no stray local dolt data-dir, so it never spawns a rogue
        // server. Best-effort: a resolution failure must not block the spawn.
        try {
          const { port } = resolveWorktreeDoltEnv(req.projectPath, worktreePath);
          isolationEnv["BEADS_DOLT_SERVER_PORT"] = String(port);
        } catch (err) {
          logWarn("Could not resolve supervised Dolt port for worktree agent", {
            name: req.name,
            error: String(err),
          });
        }
      } else {
        logWarn("Worktree isolation requested but unavailable — agent will run in the canonical checkout", {
          name: req.name,
        });
      }
    }

    // adj-dpgqc: a resume is a different act from a spawn. `claude --resume <id>`
    // resolves the session against the directory it starts in, so verify the
    // transcript actually belongs to the directory we are about to launch in —
    // otherwise Claude quietly starts a different session and the agent comes back
    // as a stranger.
    if (req.resumeSessionId) {
      const resumable = await listResumableSessions({ projectPath: effectiveProjectPath });
      if (!resumable.some((s) => s.sessionId === req.resumeSessionId)) {
        logWarn("Refusing to resume — transcript not found for working directory", {
          name: req.name,
          projectPath: effectiveProjectPath,
          resumeSessionId: req.resumeSessionId,
        });
        return {
          success: false,
          error:
            `Session '${req.resumeSessionId}' not found for ${effectiveProjectPath}. ` +
            `List the agent's resumable sessions and pick one recorded for that directory.`,
        };
      }

      const resumeResult = await bridge.createSession({
        name: req.name,
        projectPath: effectiveProjectPath,
        mode: (req.mode ?? "swarm") as SessionMode,
        resumeSessionId: req.resumeSessionId,
        // The transcript IS the context: no constitution, no persona, no genesis.
        ...(req.resumeNote ? { initialPrompt: req.resumeNote } : {}),
        ...(Object.keys({ ...req.envVars, ...isolationEnv }).length > 0
          ? { envVars: { ...req.envVars, ...isolationEnv } }
          : {}),
      });

      if (!resumeResult.success) {
        logWarn("Agent resume failed", { name: req.name, error: resumeResult.error });
        return { success: false, error: resumeResult.error };
      }

      logInfo("Agent resumed from transcript", {
        name: req.name,
        sessionId: resumeResult.sessionId,
        resumeSessionId: req.resumeSessionId,
      });
      scheduleSpawnHealthCheck(req.name, tmuxSession);
      return { success: true, sessionId: resumeResult.sessionId, tmuxSession };
    }

    // Constitution injection (adj-160): Read project constitution and inject
    // into the effective prompt so every agent receives project-specific rules.
    const constitutionText = await readProjectConstitution(effectiveProjectPath);
    const constitutionPrompt = formatConstitutionPrompt(constitutionText);

    // Living Personas (adj-158.2.3): If the callsign has no linked persona
    // and no agent file is specified, prepend a genesis prompt so the agent
    // creates its persona before starting work.
    let effectivePrompt = req.initialPrompt;

    // adj-j0jpz: inject the persona prompt DIRECTLY into the spawn prompt. This is the
    // primary, project-agnostic delivery — it needs nothing from the target project (no
    // registered hook, no on-disk agent file, no worktree cooperation), so the persona
    // reaches turn-1 context even for agents spawned into a non-adjutant repo (the exact
    // failure in this bug). Goes before the task; the constitution is prepended after this
    // so final order is constitution → persona → task.
    if (req.personaPrompt) {
      effectivePrompt = effectivePrompt
        ? `${req.personaPrompt}\n\n---\n\n${effectivePrompt}`
        : req.personaPrompt;
      logInfo("Injecting persona prompt into spawn prompt", { name: req.name });
    }

    // Genesis is only for callsigns with NO persona at all — never when a persona prompt
    // was injected above (mutually exclusive).
    if (!req.agentFile && !req.personaPrompt) {
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
    // Merge caller env with the worktree-isolation env (BEADS_DOLT_SERVER_PORT, adj-182.3.1).
    const mergedEnvVars = { ...req.envVars, ...isolationEnv };
    const result = await bridge.createSession({
      name: req.name,
      projectPath: effectiveProjectPath,
      mode,
      ...(claudeArgs.length > 0 ? { claudeArgs } : {}),
      ...(effectivePrompt ? { initialPrompt: effectivePrompt } : {}),
      ...(Object.keys(mergedEnvVars).length > 0 ? { envVars: mergedEnvVars } : {}),
    });

    if (result.success) {
      logInfo("Agent spawned", {
        name: req.name,
        sessionId: result.sessionId,
      });

      scheduleSpawnHealthCheck(req.name, tmuxSession);

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
