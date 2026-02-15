/**
 * SessionConnector — attaches to tmux sessions via pipe-pane for output capture.
 *
 * Uses `tmux pipe-pane` to stream output from a tmux pane to a FIFO,
 * then reads the FIFO and broadcasts lines to connected clients.
 */

import { execFile } from "child_process";
import { createReadStream, mkdirSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { logInfo, logWarn } from "../utils/index.js";
import type { SessionRegistry } from "./session-registry.js";

// ============================================================================
// Types
// ============================================================================

export interface OutputHandler {
  (sessionId: string, line: string): void;
}

interface PipeState {
  sessionId: string;
  pipePath: string;
  active: boolean;
  abortController?: AbortController;
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
// SessionConnector
// ============================================================================

export class SessionConnector {
  private pipes = new Map<string, PipeState>();
  private outputHandlers: OutputHandler[] = [];
  private pipeDir: string;
  private registry: SessionRegistry;

  constructor(registry: SessionRegistry, pipeDir?: string) {
    this.registry = registry;
    this.pipeDir = pipeDir ?? join(tmpdir(), "adjutant");

    if (!existsSync(this.pipeDir)) {
      mkdirSync(this.pipeDir, { recursive: true });
    }
  }

  /**
   * Register a handler that receives output lines from sessions.
   */
  onOutput(handler: OutputHandler): void {
    this.outputHandlers.push(handler);
  }

  /**
   * Remove an output handler.
   */
  offOutput(handler: OutputHandler): void {
    this.outputHandlers = this.outputHandlers.filter((h) => h !== handler);
  }

  /**
   * Attach pipe-pane to a session's tmux pane for output capture.
   */
  async attach(sessionId: string): Promise<boolean> {
    const session = this.registry.get(sessionId);
    if (!session) {
      logWarn("Cannot attach: session not found", { sessionId });
      return false;
    }

    if (this.pipes.has(sessionId)) {
      logWarn("Already attached to session", { sessionId });
      return true;
    }

    const pipePath = join(this.pipeDir, `session-${sessionId}.pipe`);

    try {
      // Start pipe-pane to capture output to a file
      await execTmuxCommand([
        "pipe-pane",
        "-o",
        "-t",
        session.tmuxPane,
        `cat >> ${pipePath}`,
      ]);

      const pipe: PipeState = {
        sessionId,
        pipePath,
        active: true,
      };
      this.pipes.set(sessionId, pipe);

      session.pipeActive = true;
      logInfo("Pipe attached", { sessionId, tmuxPane: session.tmuxPane });

      // Start reading the pipe file
      this.startReading(pipe);

      return true;
    } catch (err) {
      logWarn("Failed to attach pipe-pane", {
        sessionId,
        error: String(err),
      });
      return false;
    }
  }

  /**
   * Detach pipe-pane from a session.
   */
  async detach(sessionId: string): Promise<boolean> {
    const pipe = this.pipes.get(sessionId);
    if (!pipe) return false;

    const session = this.registry.get(sessionId);

    try {
      if (session) {
        await execTmuxCommand(["pipe-pane", "-t", session.tmuxPane]);
        session.pipeActive = false;
      }
    } catch {
      // tmux session might already be gone
    }

    pipe.active = false;
    pipe.abortController?.abort();
    this.pipes.delete(sessionId);

    // Clean up pipe file
    try {
      if (existsSync(pipe.pipePath)) {
        unlinkSync(pipe.pipePath);
      }
    } catch {
      // ignore cleanup errors
    }

    logInfo("Pipe detached", { sessionId });
    return true;
  }

  /**
   * Check if a session has an active pipe.
   */
  isAttached(sessionId: string): boolean {
    return this.pipes.has(sessionId) && (this.pipes.get(sessionId)?.active ?? false);
  }

  /**
   * Get count of active pipes.
   */
  get activePipeCount(): number {
    return this.pipes.size;
  }

  /**
   * Detach all pipes and clean up.
   */
  async detachAll(): Promise<void> {
    const sessionIds = Array.from(this.pipes.keys());
    await Promise.all(sessionIds.map((id) => this.detach(id)));
  }

  /**
   * Capture a snapshot of a tmux pane (for sessions without pipe-pane).
   */
  async capturePane(sessionId: string): Promise<string | null> {
    const session = this.registry.get(sessionId);
    if (!session) return null;

    try {
      const output = await execTmuxCommand([
        "capture-pane",
        "-t",
        session.tmuxPane,
        "-e",
        "-p",
      ]);
      return output;
    } catch {
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private startReading(pipe: PipeState): void {
    const ac = new AbortController();
    pipe.abortController = ac;

    try {
      const stream = createReadStream(pipe.pipePath, {
        encoding: "utf8",
        signal: ac.signal,
      });

      let buffer = "";

      stream.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          this.emitOutput(pipe.sessionId, line);
        }
      });

      stream.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code === "ABORT_ERR") return;
        logWarn("Pipe read error", {
          sessionId: pipe.sessionId,
          error: String(err),
        });
      });

      stream.on("end", () => {
        // Flush remaining buffer
        if (buffer.length > 0) {
          this.emitOutput(pipe.sessionId, buffer);
          buffer = "";
        }
      });
    } catch (err) {
      logWarn("Failed to start reading pipe", {
        sessionId: pipe.sessionId,
        error: String(err),
      });
    }
  }

  private emitOutput(sessionId: string, line: string): void {
    // Store in registry's output buffer
    this.registry.appendOutput(sessionId, line);

    // Notify handlers
    for (const handler of this.outputHandlers) {
      try {
        handler(sessionId, line);
      } catch (err) {
        logWarn("Output handler error", { error: String(err) });
      }
    }
  }
}
