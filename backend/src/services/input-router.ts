/**
 * InputRouter — routes WebSocket input to tmux sessions via paste-buffer.
 *
 * Handles text input, permission responses, and interrupt (Ctrl-C) signals.
 * Queues input when sessions are busy and delivers in FIFO order when idle.
 *
 * Text delivery uses a two-phase approach:
 *   1. set-buffer + paste-buffer delivers the text atomically into the pane.
 *   2. After a short delay, send-keys Enter submits the input.
 *
 * This avoids TWO failure modes:
 *   - adj-53kf: send-keys -l (char-by-char) + send-keys Enter raced because
 *     they were separate tmux IPC calls and Enter could arrive mid-text.
 *   - adj-twhj: set-buffer + paste-buffer with trailing \n didn't submit
 *     because tmux bracketed paste mode wraps the paste in escape sequences,
 *     making the \n literal text inside the paste event, not Enter.
 *
 * The current approach pastes text WITHOUT \n (so bracketed paste is fine),
 * then sends Enter separately after the paste has been processed.
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

/**
 * Delay (ms) between pasting text and sending Enter.
 * Gives the TUI time to process the paste event before we submit.
 * paste-buffer delivers text atomically (instant), so this only needs to
 * cover the TUI's event-loop tick for processing the pasted content.
 */
const PASTE_ENTER_DELAY_MS = 150;

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
 * Send text to a tmux pane and submit it (Enter).
 *
 * Two-phase delivery:
 *   1. set-buffer + paste-buffer loads the text atomically into the pane.
 *      The text does NOT include a trailing newline — bracketed paste mode
 *      would treat \n as literal text, not Enter (adj-twhj).
 *   2. After a short delay, send-keys Enter submits the input.
 *      The delay lets the TUI process the paste before we hit Enter.
 *      Unlike the old send-keys -l approach (adj-53kf), paste-buffer delivers
 *      ALL text in one shot, so Enter cannot arrive mid-text.
 */
async function tmuxPasteText(pane: string, text: string): Promise<void> {
  const bufferName = `adj-input-${++bufferCounter}`;
  // Phase 1: Load text into a tmux buffer and paste it into the pane.
  // No trailing \n — we send Enter separately to avoid bracketed paste issues.
  await execTmuxCommand(["set-buffer", "-b", bufferName, text]);
  // -d deletes the buffer after pasting
  await execTmuxCommand(["paste-buffer", "-t", pane, "-b", bufferName, "-d"]);
  // Phase 2: Wait for the TUI to process the paste, then send Enter.
  await new Promise((resolve) => setTimeout(resolve, PASTE_ENTER_DELAY_MS));
  await execTmuxCommand(["send-keys", "-t", pane, "Enter"]);
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
      // Strip trailing newlines — Enter is sent separately after paste
      const clean = text.replace(/\n+$/, "");

      // Deduplication: skip if the same text was sent to this pane recently
      const now = Date.now();
      const recent = this.recentInputs.get(tmuxPane);
      if (recent && recent.text === clean && now - recent.sentAt < DEDUP_WINDOW_MS) {
        logInfo("Skipping duplicate input", { tmuxPane, textLength: clean.length });
        return true; // Report success — the message was already delivered
      }

      // Two-phase delivery: paste text atomically, then send Enter after delay.
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
