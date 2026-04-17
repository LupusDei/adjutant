/**
 * LifecycleManager — creates and kills tmux sessions with Claude Code.
 *
 * Handles session creation with workspace setup (primary, worktree, copy)
 * and session teardown with cleanup.
 */

import { execFile } from "child_process";
import { logInfo, logWarn } from "../utils/index.js";
import type { SessionRegistry, SessionMode, WorkspaceType } from "./session-registry.js";

// ============================================================================
// Types
// ============================================================================

export interface CreateSessionRequest {
  name: string;
  projectPath: string;
  mode?: SessionMode | undefined;
  workspaceType?: WorkspaceType | undefined;
  claudeArgs?: string[] | undefined;
  /** Additional environment variables to set in the tmux session before starting Claude. */
  envVars?: Record<string, string> | undefined;
  /** Prompt to inject into the session after Claude starts (via tmux send-keys). */
  initialPrompt?: string | undefined;
}

export interface CreateSessionResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_SESSIONS = 10;

/** How often to poll tmux pane content when waiting for Claude readiness. */
const READINESS_POLL_MS = 500;

/** How long pane content must be stable before we consider Claude ready. */
const READINESS_STABLE_MS = 2_000;

/** Maximum time to wait for Claude Code to become ready for input. */
const READINESS_TIMEOUT_MS = 30_000;

/** Delay between pasting spawn prompt text and pressing Enter. */
const PASTE_ENTER_DELAY_MS = 150;

/** Max retries for spawn prompt delivery. */
const PROMPT_DELIVERY_RETRIES = 2;

/** Escape a string for safe use in a shell command sent via tmux send-keys. */
function shellEscape(s: string): string {
  // Allow only alphanumeric, hyphen, underscore, dot
  if (/^[a-zA-Z0-9._-]+$/.test(s)) return s;
  // Wrap in single quotes, escaping embedded single quotes
  return `'${s.replace(/'/g, "'\\''")}'`;
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

function execTmuxCommand(args: string[]): Promise<string> {
  return execCommand("tmux", args);
}

/**
 * Query tmux for the first pane of a session.
 * Respects user's base-index and pane-base-index settings.
 * Returns a fully-qualified pane reference like "session:1.1".
 */
async function resolveFirstPane(tmuxSession: string): Promise<string> {
  const output = await execTmuxCommand([
    "list-panes",
    "-t",
    tmuxSession,
    "-F",
    "#{session_name}:#{window_index}.#{pane_index}",
  ]);
  const firstPane = output.trim().split("\n")[0];
  if (!firstPane) {
    throw new Error(`No panes found in tmux session '${tmuxSession}'`);
  }
  return firstPane;
}

// ============================================================================
// LifecycleManager
// ============================================================================

export class LifecycleManager {
  private registry: SessionRegistry;
  private maxSessions: number;

  constructor(registry: SessionRegistry, maxSessions?: number) {
    this.registry = registry;
    this.maxSessions = maxSessions ?? MAX_SESSIONS;
  }

  /**
   * Create a new tmux session with Claude Code.
   */
  async createSession(req: CreateSessionRequest): Promise<CreateSessionResult> {
    // Check session limit
    if (this.registry.size >= this.maxSessions) {
      return {
        success: false,
        error: `Session limit reached (max ${this.maxSessions})`,
      };
    }

    const tmuxSessionName = this.generateTmuxName(req.name, req.mode);

    // Check if tmux session already exists
    try {
      await execTmuxCommand(["has-session", "-t", tmuxSessionName]);
      return {
        success: false,
        error: `tmux session '${tmuxSessionName}' already exists`,
      };
    } catch {
      // Session doesn't exist — good, we can create it
    }

    try {
      // Create the tmux session
      await execTmuxCommand([
        "new-session",
        "-d",
        "-s",
        tmuxSessionName,
        "-c",
        req.projectPath,
      ]);

      // Query tmux for the actual first pane reference.
      // This respects the user's base-index/pane-base-index settings
      // instead of assuming :0.0.
      const tmuxPane = await resolveFirstPane(tmuxSessionName);

      // Register the session with the correct pane reference
      const session = this.registry.create({
        name: req.name,
        tmuxSession: tmuxSessionName,
        tmuxPane,
        projectPath: req.projectPath,
        mode: req.mode ?? "swarm",
        workspaceType: req.workspaceType ?? "primary",
      });

      // Set agent identity and project env vars so the MCP server can
      // identify this agent and resolve its project context.
      // ADJUTANT_PROJECT_ROOT is the canonical project identifier — the
      // MCP server derives the project ID by matching against the registry.
      await execTmuxCommand([
        "send-keys",
        "-t",
        tmuxSessionName,
        `export ADJUTANT_AGENT_ID=${shellEscape(req.name)}`,
        "Enter",
      ]);
      await execTmuxCommand([
        "send-keys",
        "-t",
        tmuxSessionName,
        `export ADJUTANT_PROJECT_ROOT=${shellEscape(req.projectPath)}`,
        "Enter",
      ]);

      // Set additional env vars (e.g., ADJUTANT_PERSONA_ID for persona hooks)
      if (req.envVars) {
        for (const [key, value] of Object.entries(req.envVars)) {
          await execTmuxCommand([
            "send-keys",
            "-t",
            tmuxSessionName,
            `export ${key}=${shellEscape(value)}`,
            "Enter",
          ]);
        }
      }

      // Start Claude Code in the session
      // Always include --dangerously-skip-permissions so agents don't block on prompts.
      // Custom claudeArgs are appended after the mandatory flag.
      const baseArgs = ["--dangerously-skip-permissions"];
      const extraArgs = req.claudeArgs?.filter((a) => a !== "--dangerously-skip-permissions") ?? [];
      const claudeCmd = `claude ${[...baseArgs, ...extraArgs].join(" ")}`;

      await execTmuxCommand([
        "send-keys",
        "-t",
        tmuxSessionName,
        claudeCmd,
        "Enter",
      ]);

      // Wait for the pane to be responsive before returning.
      // This prevents the race condition where iOS connects via WebSocket
      // before pipe-pane can attach to the pane.
      await this.waitForPane(tmuxPane);

      // If an initial prompt was provided, inject it after Claude is ready.
      // adj-132: The old 3-second fixed delay was insufficient — Claude Code
      // often hadn't finished startup (SessionStart hooks, CLAUDE.md loading)
      // and the prompt was lost or arrived while the agent was bootstrapping.
      //
      // New approach: poll the tmux pane content until it stabilizes (Claude
      // finished startup and is showing its input prompt), then deliver.
      //
      // Two-phase delivery (adj-53kf, adj-twhj):
      //   1. set-buffer + paste-buffer delivers the text atomically into the pane.
      //   2. After a short delay, send-keys Enter submits the input.
      if (req.initialPrompt) {
        await this.waitForClaudeReady(tmuxPane);
        await this.deliverSpawnPrompt(tmuxSessionName, tmuxPane, req.initialPrompt);
      }

      this.registry.updateStatus(session.id, "idle");

      logInfo("Session created", {
        sessionId: session.id,
        tmuxSession: tmuxSessionName,
        hasInitialPrompt: !!req.initialPrompt,
      });

      return { success: true, sessionId: session.id };
    } catch (err) {
      logWarn("Failed to create session", { error: String(err) });
      return { success: false, error: String(err) };
    }
  }

  /**
   * Export environment variables into an existing tmux session.
   * Used to re-inject env vars (e.g., ADJUTANT_PERSONA_ID) on respawn
   * when the tmux session survived a backend restart.
   */
  async exportEnvVars(tmuxSession: string, envVars: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(envVars)) {
      await execTmuxCommand([
        "send-keys",
        "-t",
        tmuxSession,
        `export ${key}=${shellEscape(value)}`,
        "Enter",
      ]);
    }
    logInfo("Re-exported env vars to existing session", {
      tmuxSession,
      keys: Object.keys(envVars),
    });
  }

  /**
   * Kill a tmux session and clean up (including worktree removal for
   * worktree-isolated sessions — adj-085).
   */
  async killSession(sessionId: string): Promise<boolean> {
    const session = this.registry.get(sessionId);
    if (!session) {
      logWarn("Cannot kill: session not found", { sessionId });
      return false;
    }

    try {
      await execTmuxCommand(["kill-session", "-t", session.tmuxSession]);
    } catch {
      // Session might already be gone
    }

    // Clean up git worktree if this was a worktree-isolated session (adj-085)
    if (session.workspaceType === "worktree") {
      try {
        const projectRoot = process.env["ADJUTANT_PROJECT_ROOT"] || process.cwd();
        await new Promise<void>((resolve, reject) => {
          execFile("git", ["worktree", "remove", session.projectPath, "--force"],
            { cwd: projectRoot },
            (err) => { if (err) { reject(err as Error); } else { resolve(); } }
          );
        });
        logInfo("Removed worktree on session kill", { sessionId, path: session.projectPath });
      } catch (err) {
        logWarn("Worktree cleanup failed (may already be removed)", {
          sessionId,
          path: session.projectPath,
          error: String(err),
        });
      }
    }

    this.registry.updateStatus(sessionId, "offline");
    this.registry.remove(sessionId);

    logInfo("Session killed", {
      sessionId,
      tmuxSession: session.tmuxSession,
    });

    return true;
  }

  /**
   * Check if a tmux session is alive (session exists AND target pane is valid).
   * If the registered pane is stale but the session has other panes, auto-heal
   * by updating the registry to the first available pane.
   */
  async isAlive(sessionId: string): Promise<boolean> {
    const session = this.registry.get(sessionId);
    if (!session) return false;

    try {
      await execTmuxCommand(["has-session", "-t", session.tmuxSession]);
    } catch {
      return false;
    }

    // Verify registered pane actually exists by listing real panes
    // NOTE: display-message is too lenient — it auto-resolves invalid targets like :0.0
    // to the nearest pane, but pipe-pane requires exact window:pane references.
    try {
      const paneList = await execTmuxCommand([
        "list-panes", "-t", session.tmuxSession, "-F", "#{session_name}:#{window_index}.#{pane_index}",
      ]);
      const actualPanes = paneList.trim().split("\n").filter((l) => l.length > 0);
      if (actualPanes.length === 0) return false;

      // Check if the registered pane matches any real pane
      if (actualPanes.includes(session.tmuxPane)) {
        return true;
      }

      // Auto-heal: registered pane is stale, use the first real pane
      const firstPane = actualPanes[0]!;
      logInfo("Auto-healed stale pane reference", {
        sessionId,
        oldPane: session.tmuxPane,
        newPane: firstPane,
      });
      session.tmuxPane = firstPane;
      return true;
    } catch {
      // list-panes failed — session has no panes
      return false;
    }
  }

  /**
   * Discover existing tmux sessions and register them.
   */
  async discoverSessions(prefix?: string): Promise<string[]> {
    try {
      const output = await execTmuxCommand([
        "list-sessions",
        "-F",
        "#{session_name}",
      ]);

      const tmuxSessions = output
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      const discovered: string[] = [];

      for (const tmuxName of tmuxSessions) {
        // Skip if already registered
        if (this.registry.findByTmuxSession(tmuxName)) continue;

        // Apply prefix filter if provided
        if (prefix && !tmuxName.startsWith(prefix)) continue;

        // Query the actual first pane reference (respects base-index settings)
        let tmuxPane: string | undefined;
        try {
          tmuxPane = await resolveFirstPane(tmuxName);
        } catch {
          // Skip sessions we can't resolve panes for
          continue;
        }

        const session = this.registry.create({
          name: tmuxName,
          tmuxSession: tmuxName,
          tmuxPane,
          projectPath: ".",
          mode: "swarm",
        });
        this.registry.updateStatus(session.id, "idle");
        discovered.push(session.id);
      }

      logInfo("Sessions discovered", { count: discovered.length });
      return discovered;
    } catch {
      return [];
    }
  }

  /**
   * Get the max sessions limit.
   */
  get sessionLimit(): number {
    return this.maxSessions;
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  /**
   * Wait until a tmux pane is responsive (accepts display-message).
   * Retries up to 10 times with 200ms intervals (2 seconds max).
   */
  private async waitForPane(pane: string, maxRetries = 10): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await execTmuxCommand(["display-message", "-t", pane, "-p", ""]);
        return; // Pane is responsive
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    logWarn("Pane readiness timeout — continuing anyway", { pane });
  }

  /**
   * Wait until Claude Code is ready to accept input (adj-132).
   *
   * Polls the tmux pane content until it stabilizes — meaning Claude has
   * finished startup, processed SessionStart hooks, loaded CLAUDE.md, and
   * is showing its input prompt.
   *
   * "Stable" means the pane content hasn't changed for READINESS_STABLE_MS.
   * This handles variable startup times without a fragile prompt-pattern match.
   */
  private async waitForClaudeReady(pane: string): Promise<void> {
    const startTime = Date.now();
    let lastContent = "";
    let lastChangeTime = Date.now();

    while (Date.now() - startTime < READINESS_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, READINESS_POLL_MS));

      let content: string;
      try {
        content = await execTmuxCommand(["capture-pane", "-t", pane, "-p"]);
      } catch {
        // Pane not ready yet
        continue;
      }

      if (content !== lastContent) {
        lastContent = content;
        lastChangeTime = Date.now();
      } else if (
        lastContent.length > 0 &&
        Date.now() - lastChangeTime >= READINESS_STABLE_MS
      ) {
        // Content has been stable for long enough — Claude is ready
        logInfo("Claude readiness detected", {
          pane,
          waitMs: Date.now() - startTime,
        });
        return;
      }
    }

    logWarn("Claude readiness timeout — delivering prompt anyway", {
      pane,
      timeoutMs: READINESS_TIMEOUT_MS,
    });
  }

  /**
   * Deliver a spawn prompt to a tmux session with retry logic (adj-132).
   *
   * After pasting, checks if the pane content changes (indicating Claude
   * accepted the input). If no change detected, retries delivery.
   */
  private async deliverSpawnPrompt(
    tmuxSession: string,
    pane: string,
    prompt: string,
  ): Promise<void> {
    for (let attempt = 0; attempt <= PROMPT_DELIVERY_RETRIES; attempt++) {
      // Capture pane content before delivery for change detection
      let contentBefore = "";
      try {
        contentBefore = await execTmuxCommand(["capture-pane", "-t", pane, "-p"]);
      } catch {
        // Ignore — we'll try delivery anyway
      }

      // Two-phase delivery: paste text, then send Enter
      const bufferName = `adj-spawn-${Date.now()}`;
      await execTmuxCommand(["set-buffer", "-b", bufferName, prompt]);
      await execTmuxCommand([
        "paste-buffer", "-t", tmuxSession, "-b", bufferName, "-d",
      ]);
      await new Promise((r) => setTimeout(r, PASTE_ENTER_DELAY_MS));
      await execTmuxCommand(["send-keys", "-t", tmuxSession, "Enter"]);

      // Wait briefly, then check if pane content changed (prompt was accepted)
      await new Promise((r) => setTimeout(r, 2_000));
      let contentAfter = "";
      try {
        contentAfter = await execTmuxCommand(["capture-pane", "-t", pane, "-p"]);
      } catch {
        // Can't verify — assume success
        break;
      }

      if (contentAfter !== contentBefore) {
        logInfo("Spawn prompt delivered", { pane, attempt });
        return;
      }

      if (attempt < PROMPT_DELIVERY_RETRIES) {
        logWarn("Spawn prompt may not have landed, retrying", {
          pane,
          attempt,
        });
        // Wait before retry — Claude may still be processing
        await new Promise((r) => setTimeout(r, 3_000));
      }
    }

    logWarn("Spawn prompt delivery — exhausted retries", { pane });
  }

  private generateTmuxName(name: string, _mode?: SessionMode): string {
    const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "-");
    return `adj-swarm-${sanitized}`;
  }
}
