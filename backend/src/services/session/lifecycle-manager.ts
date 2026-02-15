/**
 * LifecycleManager — create and kill tmux sessions running Claude Code.
 *
 * Handles session creation (new tmux session + launch Claude Code),
 * session discovery (find existing tmux sessions), and session teardown.
 */

import { execFile } from "child_process";
import { cp, rm } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import {
  createSession,
  getSession,
  getAllSessions,
  removeSession,
  getSessionByTmux,
  updateSession,
} from "./session-registry.js";
import { stopCapture, tmuxSessionExists, listTmuxSessions } from "./session-connector.js";
import type { ManagedSession, SessionMode, WorkspaceType } from "../../types/session.js";
import { logInfo, logWarn } from "../../utils/index.js";

// ============================================================================
// tmux Helper
// ============================================================================

function execTmux(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("tmux", args, { encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error((stderr as string)?.trim() || err.message));
        return;
      }
      resolve(stdout);
    });
  });
}

// ============================================================================
// Shell Helper
// ============================================================================

function execCmd(cmd: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "utf8", cwd }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error((stderr as string)?.trim() || err.message));
        return;
      }
      resolve(stdout);
    });
  });
}

// ============================================================================
// Workspace Preparation
// ============================================================================

const WORKSPACES_DIR = join(homedir(), ".adjutant", "workspaces");

/**
 * Prepare the working directory based on workspace type.
 *
 * - "primary": use projectPath as-is
 * - "worktree": create a git worktree from projectPath
 * - "copy": shallow-copy the project directory
 *
 * Returns the actual working directory path.
 */
async function prepareWorkspace(
  sessionName: string,
  projectPath: string,
  workspaceType: WorkspaceType,
): Promise<string> {
  if (workspaceType === "primary") {
    return projectPath;
  }

  const workDir = join(WORKSPACES_DIR, sessionName);

  if (workspaceType === "worktree") {
    const ref = (await execCmd("git", ["rev-parse", "HEAD"], projectPath)).trim();
    await execCmd("git", ["worktree", "add", workDir, ref, "--detach"], projectPath);
    logInfo("worktree created", { sessionName, workDir, ref });
    return workDir;
  }

  if (workspaceType === "copy") {
    await cp(projectPath, workDir, { recursive: true });
    logInfo("workspace copied", { sessionName, workDir });
    return workDir;
  }

  return projectPath;
}

/**
 * Clean up a workspace created by prepareWorkspace.
 */
async function cleanupWorkspace(session: ManagedSession): Promise<void> {
  if (session.workspaceType === "primary") return;

  const workDir = join(WORKSPACES_DIR, session.name);

  try {
    if (session.workspaceType === "worktree") {
      await execCmd("git", ["worktree", "remove", workDir, "--force"], session.projectPath);
      logInfo("worktree removed", { sessionId: session.id, workDir });
    } else if (session.workspaceType === "copy") {
      await rm(workDir, { recursive: true, force: true });
      logInfo("workspace copy removed", { sessionId: session.id, workDir });
    }
  } catch (err) {
    logWarn("workspace cleanup failed (non-fatal)", {
      sessionId: session.id,
      workspaceType: session.workspaceType,
      error: String(err),
    });
  }
}

// ============================================================================
// Session Creation
// ============================================================================

export interface LaunchOptions {
  name: string;
  projectPath: string;
  mode: SessionMode;
  workspaceType?: WorkspaceType | undefined;
  /** Custom tmux session name. Auto-generated if not provided. */
  tmuxSessionName?: string;
  /** Whether to launch Claude Code in the session. Default: true */
  launchClaude?: boolean;
  /** Custom tmux window command. */
  tmuxCommand?: string;
}

/**
 * Create a new tmux session and optionally launch Claude Code in it.
 */
export async function launchSession(opts: LaunchOptions): Promise<ManagedSession> {
  const tmuxName = opts.tmuxSessionName ?? `adj-${opts.name}-${Date.now()}`;
  const workspaceType = opts.workspaceType ?? "primary";

  // Check if tmux session name already taken
  if (await tmuxSessionExists(tmuxName)) {
    throw new Error(`tmux session '${tmuxName}' already exists`);
  }

  // Prepare workspace (worktree, copy, or use primary)
  const workDir = await prepareWorkspace(opts.name, opts.projectPath, workspaceType);

  // Create tmux session in detached mode, using the prepared workspace
  await execTmux([
    "new-session",
    "-d",
    "-s", tmuxName,
    "-c", workDir,
  ]);

  logInfo("tmux session created", { tmuxName, workDir, workspaceType });

  // Register in session registry
  const session = createSession({
    name: opts.name,
    tmuxSession: tmuxName,
    tmuxPane: `${tmuxName}:0.0`,
    projectPath: workDir,
    mode: opts.mode,
    workspaceType,
  });

  // Optionally launch Claude Code
  if (opts.launchClaude !== false) {
    try {
      await execTmux([
        "send-keys",
        "-t", `${tmuxName}:0.0`,
        "claude --dangerously-skip-permissions",
        "Enter",
      ]);
      logInfo("claude launched in session", { sessionId: session.id });
    } catch (err) {
      logWarn("failed to launch claude", { sessionId: session.id, error: String(err) });
    }
  }

  return session;
}

// ============================================================================
// Session Discovery
// ============================================================================

/** GT naming conventions for tmux sessions. */
const GT_SESSION_PATTERNS = [
  /^gt-.*-mayor$/,
  /^gt-.*-deacon$/,
  /^gt-.*-witness$/,
  /^gt-.*-refinery$/,
  /^gt-.*-polecat-/,
];

/**
 * Discover existing tmux sessions and register any that match
 * known patterns (GT sessions or Adjutant-managed sessions).
 */
export async function discoverSessions(): Promise<ManagedSession[]> {
  const tmuxSessions = await listTmuxSessions();
  const discovered: ManagedSession[] = [];

  for (const tmuxName of tmuxSessions) {
    // Skip if already tracked
    if (getSessionByTmux(tmuxName)) continue;

    // Check GT patterns
    const isGtSession = GT_SESSION_PATTERNS.some((p) => p.test(tmuxName));
    // Check adjutant-managed pattern
    const isAdjSession = tmuxName.startsWith("adj-");

    if (!isGtSession && !isAdjSession) continue;

    // Get the pane's current directory
    let projectPath = "";
    try {
      projectPath = (await execTmux([
        "display-message",
        "-t", `${tmuxName}:0.0`,
        "-p",
        "#{pane_current_path}",
      ])).trim();
    } catch {
      projectPath = "";
    }

    // Determine session name from tmux name
    let name = tmuxName;
    if (isGtSession) {
      // Extract role: gt-<town>-<role> or gt-<town>-polecat-<name>
      const parts = tmuxName.split("-");
      name = parts.slice(2).join("-"); // e.g., "mayor", "polecat-obsidian"
    }

    const session = createSession({
      name,
      tmuxSession: tmuxName,
      tmuxPane: `${tmuxName}:0.0`,
      projectPath,
      mode: isGtSession ? "gastown" : "standalone",
    });

    updateSession(session.id, { status: "idle" });
    discovered.push(session);
  }

  if (discovered.length > 0) {
    logInfo("sessions discovered", { count: discovered.length, names: discovered.map((s) => s.name) });
  }

  return discovered;
}

// ============================================================================
// Session Teardown
// ============================================================================

/**
 * Kill a managed session and its tmux session.
 */
export async function killSession(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  // Stop output capture
  stopCapture(sessionId);

  // Kill the tmux session
  try {
    await execTmux(["kill-session", "-t", session.tmuxSession]);
    logInfo("tmux session killed", { sessionId, tmux: session.tmuxSession });
  } catch (err) {
    logWarn("failed to kill tmux session (may already be gone)", {
      sessionId,
      error: String(err),
    });
  }

  // Clean up workspace (worktree/copy)
  await cleanupWorkspace(session);

  // Remove from registry
  removeSession(sessionId);
}

/**
 * Check which registered sessions are still alive in tmux
 * and update their status accordingly.
 */
export async function reconcileSessions(): Promise<void> {
  const tmuxSessions = new Set(await listTmuxSessions());

  for (const session of getAllSessions()) {
    const alive = tmuxSessions.has(session.tmuxSession);
    if (!alive && session.status !== "offline") {
      updateSession(session.id, { status: "offline", pipeActive: false });
      stopCapture(session.id);
      logInfo("session went offline", { sessionId: session.id, tmux: session.tmuxSession });
    } else if (alive && session.status === "offline") {
      updateSession(session.id, { status: "idle" });
      logInfo("session came back online", { sessionId: session.id });
    }
  }
}

// ============================================================================
// Lifecycle Health
// ============================================================================

let reconcileTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic session reconciliation.
 */
export function startReconciliation(intervalMs = 10_000): void {
  if (reconcileTimer) return;
  reconcileTimer = setInterval(() => {
    reconcileSessions().catch((err) => {
      logWarn("reconciliation failed", { error: String(err) });
    });
  }, intervalMs);
}

/**
 * Stop periodic reconciliation.
 */
export function stopReconciliation(): void {
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
  }
}
