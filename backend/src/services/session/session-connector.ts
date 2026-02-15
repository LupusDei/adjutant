/**
 * SessionConnector — attaches to tmux sessions and captures output.
 *
 * Uses `tmux pipe-pane` to capture output from a tmux pane and stream
 * it to connected WebSocket clients. Uses FIFOs for real-time streaming.
 */

import { execFile, type ChildProcess } from "child_process";
import { mkdirSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { logInfo, logWarn } from "../../utils/index.js";
import { pushOutput, getSession, updateSession } from "./session-registry.js";

// ============================================================================
// Constants
// ============================================================================

const PIPE_DIR = join(tmpdir(), "adjutant");
const CAPTURE_INTERVAL_MS = 500;

// ============================================================================
// State
// ============================================================================

interface ActivePipe {
  sessionId: string;
  tmuxSession: string;
  tmuxPane: string;
  catProcess: ChildProcess | null;
  pipePath: string;
  captureInterval: ReturnType<typeof setInterval> | null;
}

const activePipes = new Map<string, ActivePipe>();
let outputHandler: ((sessionId: string, data: string) => void) | null = null;

// ============================================================================
// Setup
// ============================================================================

export function setOutputHandler(handler: (sessionId: string, data: string) => void): void {
  outputHandler = handler;
}

// ============================================================================
// tmux Helpers
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
// Pipe Management
// ============================================================================

/**
 * Start capturing output from a tmux pane.
 *
 * Uses periodic `tmux capture-pane` instead of pipe-pane + FIFO for
 * reliability. capture-pane is simpler and avoids FIFO edge cases.
 */
export async function startCapture(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  if (activePipes.has(sessionId)) return; // Already capturing

  // Ensure pipe directory exists
  if (!existsSync(PIPE_DIR)) {
    mkdirSync(PIPE_DIR, { recursive: true });
  }

  const pipePath = join(PIPE_DIR, `session-${sessionId}.pipe`);

  // Start pipe-pane to write output to a file
  try {
    await execTmux([
      "pipe-pane",
      "-o",
      "-t", session.tmuxPane,
      `cat >> ${pipePath}`,
    ]);
  } catch (err) {
    logWarn("pipe-pane failed, falling back to capture-pane polling", {
      sessionId,
      error: String(err),
    });
  }

  // Track last captured content to detect changes
  let lastContent = "";

  // Poll capture-pane for output changes
  const captureInterval = setInterval(async () => {
    try {
      const content = await execTmux([
        "capture-pane",
        "-t", session.tmuxPane,
        "-e",
        "-p",
      ]);

      if (content !== lastContent) {
        const newContent = content;
        lastContent = content;

        // Buffer and dispatch
        pushOutput(sessionId, newContent);
        if (outputHandler) {
          outputHandler(sessionId, newContent);
        }
      }
    } catch {
      // Session may have been killed — stop capturing
      stopCapture(sessionId);
    }
  }, CAPTURE_INTERVAL_MS);

  const pipe: ActivePipe = {
    sessionId,
    tmuxSession: session.tmuxSession,
    tmuxPane: session.tmuxPane,
    catProcess: null,
    pipePath,
    captureInterval,
  };

  activePipes.set(sessionId, pipe);
  updateSession(sessionId, { pipeActive: true });
  logInfo("capture started", { sessionId, tmux: session.tmuxPane });
}

/**
 * Stop capturing output from a session.
 */
export function stopCapture(sessionId: string): void {
  const pipe = activePipes.get(sessionId);
  if (!pipe) return;

  if (pipe.captureInterval) {
    clearInterval(pipe.captureInterval);
  }

  if (pipe.catProcess) {
    pipe.catProcess.kill();
  }

  // Stop tmux pipe-pane
  execTmux(["pipe-pane", "-t", pipe.tmuxPane]).catch(() => {
    // pipe-pane with no command stops piping — ignore errors
  });

  // Clean up pipe file
  try {
    if (existsSync(pipe.pipePath)) {
      unlinkSync(pipe.pipePath);
    }
  } catch {
    // Ignore cleanup errors
  }

  activePipes.delete(sessionId);
  updateSession(sessionId, { pipeActive: false });
  logInfo("capture stopped", { sessionId });
}

/**
 * Check if a tmux session exists.
 */
export async function tmuxSessionExists(tmuxSession: string): Promise<boolean> {
  try {
    await execTmux(["has-session", "-t", tmuxSession]);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all tmux sessions.
 */
export async function listTmuxSessions(): Promise<string[]> {
  try {
    const output = await execTmux(["list-sessions", "-F", "#{session_name}"]);
    return output.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

/**
 * Stop all active captures. Called on shutdown.
 */
export function stopAllCaptures(): void {
  for (const sessionId of activePipes.keys()) {
    stopCapture(sessionId);
  }
}

/**
 * Check if a session is being captured.
 */
export function isCapturing(sessionId: string): boolean {
  return activePipes.has(sessionId);
}
