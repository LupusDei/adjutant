/**
 * InputRouter — routes WebSocket input to tmux sessions via send-keys.
 *
 * Handles text input, permission responses, and interrupt (Ctrl-C) signals.
 * Queues input when sessions are busy and delivers in FIFO order when idle.
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

// ============================================================================
// InputRouter
// ============================================================================

export class InputRouter {
  private registry: SessionRegistry;
  private queues = new Map<string, QueuedInput[]>();

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

    // Queue if session is busy
    if (session.status === "working") {
      this.enqueue(sessionId, text);
      logInfo("Input queued (session busy)", { sessionId });
      return true;
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

  private enqueue(sessionId: string, text: string): void {
    if (!this.queues.has(sessionId)) {
      this.queues.set(sessionId, []);
    }
    this.queues.get(sessionId)!.push({
      text,
      timestamp: new Date(),
    });
  }

  private async deliverInput(tmuxPane: string, text: string): Promise<boolean> {
    try {
      await execTmuxCommand(["send-keys", "-t", tmuxPane, text, "Enter"]);
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
