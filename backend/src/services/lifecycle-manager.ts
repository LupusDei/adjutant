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
  mode?: SessionMode;
  workspaceType?: WorkspaceType;
  claudeArgs?: string[];
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

      // Start Claude Code in the session
      const claudeArgs = req.claudeArgs ?? ["--dangerously-skip-permissions"];
      const claudeCmd = `claude ${claudeArgs.join(" ")}`;

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

      this.registry.updateStatus(session.id, "working");

      logInfo("Session created", {
        sessionId: session.id,
        tmuxSession: tmuxSessionName,
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

    // Check if the registered pane is still valid
    try {
      await execTmuxCommand(["display-message", "-t", session.tmuxPane, "-p", ""]);
      return true;
    } catch {
      // Pane is gone — try to find the first available pane in the session
      try {
        const paneList = await execTmuxCommand([
          "list-panes", "-t", session.tmuxSession, "-F", "#{session_name}:#{window_index}.#{pane_index}",
        ]);
        const firstPane = paneList.trim().split("\n")[0];
        if (firstPane) {
          // Auto-heal: update the registry with the correct pane
          logInfo("Auto-healed stale pane reference", {
            sessionId,
            oldPane: session.tmuxPane,
            newPane: firstPane,
          });
          session.tmuxPane = firstPane;
          return true;
        }
      } catch {
        // No panes at all
      }
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

  private generateTmuxName(name: string, mode?: SessionMode): string {
    const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "-");
    switch (mode) {
      case "gastown":
        return sanitized;
      case "swarm":
        return `adj-swarm-${sanitized}`;
      default:
        return `adj-${sanitized}`;
    }
  }
}
