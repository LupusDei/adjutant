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

      // Set agent identity env var so the MCP server can identify this agent
      await execTmuxCommand([
        "send-keys",
        "-t",
        tmuxSessionName,
        `export ADJUTANT_AGENT_ID=${shellEscape(req.name)}`,
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
      // Two-phase delivery (adj-53kf, adj-twhj):
      //   1. set-buffer + paste-buffer delivers the text atomically into the pane.
      //   2. After a short delay, send-keys Enter submits the input.
      // This avoids both the send-keys char-by-char race (adj-53kf) and the
      // bracketed paste \n-as-literal-text issue (adj-twhj).
      if (req.initialPrompt) {
        // Brief delay to let Claude Code finish initialization
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        const bufferName = `adj-spawn-${Date.now()}`;
        // Phase 1: Paste text (no trailing \n)
        await execTmuxCommand([
          "set-buffer",
          "-b",
          bufferName,
          req.initialPrompt,
        ]);
        await execTmuxCommand([
          "paste-buffer",
          "-t",
          tmuxSessionName,
          "-b",
          bufferName,
          "-d",
        ]);
        // Phase 2: Wait for TUI to process paste, then send Enter
        await new Promise((resolve) => setTimeout(resolve, 150));
        await execTmuxCommand([
          "send-keys",
          "-t",
          tmuxSessionName,
          "Enter",
        ]);
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
   * Kill a tmux session and clean up.
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

  private generateTmuxName(name: string, _mode?: SessionMode): string {
    const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "-");
    return `adj-swarm-${sanitized}`;
  }
}
