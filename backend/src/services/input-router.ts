/**
 * InputRouter — routes WebSocket input to tmux sessions via paste-buffer.
 *
 * Handles text input, permission responses, and interrupt (Ctrl-C) signals.
 * Queues input when sessions are busy and delivers in FIFO order when idle.
 *
 * Text delivery uses tmux set-buffer + paste-buffer for atomic delivery.
 * The text is loaded into a named buffer with a trailing newline, then
 * pasted into the target pane in a single operation. This eliminates the
 * race condition where a separate "Enter" key arrives before the text
 * paste completes (adj-53kf, adj-twhj).
 */

import { execFile } from "child_process";
import { logInfo, logWarn } from "../utils/index.js";
import type { SessionRegistry } from "./session-registry.js";

// ============================================================================
// Types
// ============================================================================

export interface QueuedInput {
  text: string;
  timestamp: Date;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Window (ms) within which duplicate text sent to the same pane is suppressed.
 * Prevents the same prompt from being injected multiple times when multiple
 * systems (stimulus engine, message delivery, etc.) fire in quick succession.
 */
const DEDUP_WINDOW_MS = 5_000;

// ============================================================================
// Helpers
// ============================================================================

function execTmuxCommand(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("tmux", args, { encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
        return;
      }
      resolve(stdout);
    });
  });
}

/** Monotonically increasing counter for unique tmux buffer names. */
let bufferCounter = 0;

/**
 * Atomically send text + Enter to a tmux pane using set-buffer + paste-buffer.
 *
 * This avoids the race condition in the old approach (send-keys -l text, then
 * send-keys Enter as separate commands). The buffer includes a trailing newline
 * which acts as Enter when pasted. tmux pastes the entire buffer in one operation.
 */
async function tmuxPasteText(pane: string, text: string): Promise<void> {
  const bufferName = `adj-input-${++bufferCounter}`;
  // Append newline so the paste includes Enter (submit)
  await execTmuxCommand(["set-buffer", "-b", bufferName, text + "\n"]);
  // Paste the buffer into the target pane; -d deletes the buffer after pasting
  await execTmuxCommand(["paste-buffer", "-t", pane, "-b", bufferName, "-d"]);
}

// ============================================================================
// InputRouter
// ============================================================================

export class InputRouter {
  private registry: SessionRegistry;
  private queues = new Map<string, QueuedInput[]>();
  /** Track recent inputs per pane for deduplication: pane → { text, timestamp } */
  private recentInputs = new Map<string, { text: string; sentAt: number }>();

  constructor(registry: SessionRegistry) {
    this.registry = registry;
  }

  /**
   * Send text input to a session's tmux pane.
   * If the session is working, the input is queued.
   */
  async sendInput(sessionId: string, text: string): Promise<boolean> {
    const session = this.registry.get(sessionId);
    if (!session) {
      logWarn("Cannot send input: session not found", { sessionId });
      return false;
    }

    if (session.status === "offline") {
      logWarn("Cannot send input: session is offline", { sessionId });
      return false;
    }

    return this.deliverInput(session.tmuxPane, text);
  }

  /**
   * Send a permission response (y/n) to a session.
   */
  async sendPermissionResponse(
    sessionId: string,
    approved: boolean
  ): Promise<boolean> {
    const session = this.registry.get(sessionId);
    if (!session) return false;

    const response = approved ? "y" : "n";
    return this.deliverInput(session.tmuxPane, response);
  }

  /**
   * Send Ctrl-C (interrupt) to a session.
   */
  async sendInterrupt(sessionId: string): Promise<boolean> {
    const session = this.registry.get(sessionId);
    if (!session) {
      logWarn("Cannot interrupt: session not found", { sessionId });
      return false;
    }

    try {
      await execTmuxCommand(["send-keys", "-t", session.tmuxPane, "C-c"]);
      logInfo("Interrupt sent", { sessionId });

      // Clear the input queue — user interrupted, so queued messages are stale
      this.clearQueue(sessionId);

      return true;
    } catch (err) {
      logWarn("Failed to send interrupt", {
        sessionId,
        error: String(err),
      });
      return false;
    }
  }

  /**
   * Flush queued input for a session (call when session becomes idle).
   */
  async flushQueue(sessionId: string): Promise<number> {
    const queue = this.queues.get(sessionId);
    if (!queue || queue.length === 0) return 0;

    const session = this.registry.get(sessionId);
    if (!session) return 0;

    let delivered = 0;
    while (queue.length > 0) {
      const item = queue.shift()!;
      const ok = await this.deliverInput(session.tmuxPane, item.text);
      if (ok) delivered++;
      else break;
    }

    if (queue.length === 0) {
      this.queues.delete(sessionId);
    }

    logInfo("Queue flushed", { sessionId, delivered });
    return delivered;
  }

  /**
   * Get the number of queued inputs for a session.
   */
  getQueueLength(sessionId: string): number {
    return this.queues.get(sessionId)?.length ?? 0;
  }

  /**
   * Clear the input queue for a session.
   */
  clearQueue(sessionId: string): void {
    this.queues.delete(sessionId);
  }

  /**
   * Clear all queues.
   */
  clearAllQueues(): void {
    this.queues.clear();
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private async deliverInput(tmuxPane: string, text: string): Promise<boolean> {
    try {
      // Strip trailing newlines — we append exactly one when pasting
      const clean = text.replace(/\n+$/, "");

      // Deduplication: skip if the same text was sent to this pane recently
      const now = Date.now();
      const recent = this.recentInputs.get(tmuxPane);
      if (recent && recent.text === clean && now - recent.sentAt < DEDUP_WINDOW_MS) {
        logInfo("Skipping duplicate input", { tmuxPane, textLength: clean.length });
        return true; // Report success — the message was already delivered
      }

      // Atomic delivery: set-buffer loads text+newline, paste-buffer sends it all at once.
      // The trailing newline acts as Enter, eliminating the race condition where a
      // separate Enter key arrives before the text paste completes (adj-53kf, adj-twhj).
      await tmuxPasteText(tmuxPane, clean);

      // Track for deduplication
      this.recentInputs.set(tmuxPane, { text: clean, sentAt: Date.now() });

      return true;
    } catch (err) {
      logWarn("Failed to deliver input", {
        tmuxPane,
        error: String(err),
      });
      return false;
    }
  }
}
