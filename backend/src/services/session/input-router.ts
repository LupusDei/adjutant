/**
 * InputRouter — routes WebSocket input to tmux sessions.
 *
 * Sends text input via `tmux send-keys` and handles interrupts (Ctrl-C).
 */

import { execFile } from "child_process";
import { getSession, updateSession } from "./session-registry.js";
import { logInfo } from "../../utils/index.js";

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
// Input Operations
// ============================================================================

/**
 * Send text input to a session's tmux pane, followed by Enter.
 */
export async function sendInput(sessionId: string, text: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  // Sanitize input: escape any tmux special characters
  // send-keys with literal flag (-l) prevents interpretation of key names
  await execTmux([
    "send-keys",
    "-t", session.tmuxPane,
    "-l",
    text,
  ]);
  // Send Enter separately (not literal)
  await execTmux([
    "send-keys",
    "-t", session.tmuxPane,
    "Enter",
  ]);

  updateSession(sessionId, { status: "working" });
  logInfo("input sent", { sessionId, textLength: text.length });
}

/**
 * Send an interrupt (Ctrl-C) to a session's tmux pane.
 */
export async function sendInterrupt(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  await execTmux([
    "send-keys",
    "-t", session.tmuxPane,
    "C-c",
  ]);

  updateSession(sessionId, { status: "idle" });
  logInfo("interrupt sent", { sessionId });
}

/**
 * Send a permission response (y/n) to a session.
 */
export async function sendPermissionResponse(
  sessionId: string,
  approved: boolean,
): Promise<void> {
  const session = getSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const response = approved ? "y" : "n";
  await execTmux([
    "send-keys",
    "-t", session.tmuxPane,
    response,
  ]);
  await execTmux([
    "send-keys",
    "-t", session.tmuxPane,
    "Enter",
  ]);

  logInfo("permission response sent", { sessionId, approved });
}

/**
 * Send raw keys to a session (no literal flag, allows key names like Enter, C-c).
 */
export async function sendRawKeys(sessionId: string, keys: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  await execTmux([
    "send-keys",
    "-t", session.tmuxPane,
    keys,
  ]);
}
