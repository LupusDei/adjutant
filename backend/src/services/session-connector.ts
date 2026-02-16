/**
 * SessionConnector — attaches to tmux sessions via pipe-pane for output capture.
 *
 * Uses `tmux pipe-pane` to stream output from a tmux pane to a FIFO,
 * then reads the FIFO and broadcasts lines to connected clients.
 */

import { execFile } from "child_process";
import { mkdirSync, existsSync, unlinkSync, writeFileSync, openSync, readSync, closeSync, statSync, watch, appendFileSync, type FSWatcher } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { logInfo, logWarn } from "../utils/index.js";
import type { SessionRegistry } from "./session-registry.js";
import { OutputParser, type OutputEvent } from "./output-parser.js";

// ============================================================================
// Debug file logger for session pipe output
// ============================================================================

const PIPE_LOG_PATH = join(
  process.env["ADJUTANT_PROJECT_ROOT"] || process.cwd(),
  "logs",
  "session-pipe.log",
);

function pipeLog(sessionId: string, raw: string, events: OutputEvent[]): void {
  try {
    const dir = dirname(PIPE_LOG_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString();
    const evtSummary = events.map((e) => {
      const parts: string[] = [e.type];
      if ("tool" in e) parts.push(`tool=${e.tool}`);
      if ("content" in e) parts.push(`content=${(e.content as string).slice(0, 80)}`);
      if ("state" in e) parts.push(`state=${e.state}`);
      if ("message" in e) parts.push(`msg=${(e.message as string).slice(0, 80)}`);
      return `{${parts.join(", ")}}`;
    });
    const line = `[${ts}] sid=${sessionId} events=${events.length} raw=${JSON.stringify(raw.slice(0, 300))}${evtSummary.length > 0 ? `\n  parsed: [${evtSummary.join(", ")}]` : ""}\n`;
    appendFileSync(PIPE_LOG_PATH, line);
  } catch {
    // Never let debug logging break the pipeline
  }
}

// ============================================================================
// Types
// ============================================================================

export type { OutputEvent };

export interface OutputHandler {
  (sessionId: string, line: string, events: OutputEvent[]): void;
}

interface PipeState {
  sessionId: string;
  pipePath: string;
  active: boolean;
  watcher?: FSWatcher;
  pollTimer?: ReturnType<typeof setInterval>;
  fd?: number;
  readOffset: number;
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
  private parsers = new Map<string, OutputParser>();
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
      // Ensure the pipe file exists before pipe-pane starts writing to it.
      // pipe-pane with `cat >>` only creates the file on first output,
      // but createReadStream needs the file to exist immediately.
      if (!existsSync(pipePath)) {
        writeFileSync(pipePath, "");
      }

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
        readOffset: 0,
      };
      this.pipes.set(sessionId, pipe);
      this.parsers.set(sessionId, new OutputParser());

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

    // Flush parser and emit any final events before cleanup
    const parser = this.parsers.get(sessionId);
    if (parser) {
      const finalEvents = parser.flush();
      if (finalEvents.length > 0) {
        for (const handler of this.outputHandlers) {
          try {
            handler(sessionId, "", finalEvents);
          } catch (err) {
            logWarn("Output handler error (flush)", { error: String(err) });
          }
        }
      }
      this.parsers.delete(sessionId);
    }

    pipe.active = false;
    if (pipe.watcher) pipe.watcher.close();
    if (pipe.pollTimer) clearInterval(pipe.pollTimer);
    if (pipe.fd !== undefined) { try { closeSync(pipe.fd); } catch {} }
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
    let buffer = "";

    const readNewData = () => {
      if (!pipe.active) return;

      try {
        const stat = statSync(pipe.pipePath);
        if (stat.size <= pipe.readOffset) return;

        // Open fd on first read, reuse thereafter
        if (pipe.fd === undefined) {
          pipe.fd = openSync(pipe.pipePath, "r");
        }

        const toRead = stat.size - pipe.readOffset;
        const buf = Buffer.alloc(toRead);
        const bytesRead = readSync(pipe.fd, buf, 0, toRead, pipe.readOffset);
        if (bytesRead === 0) return;

        pipe.readOffset += bytesRead;
        const chunk = buf.toString("utf8", 0, bytesRead);

        buffer += chunk;
        const lines = buffer.split("\n");
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          this.emitOutput(pipe.sessionId, line);
        }
      } catch (err) {
        if (!pipe.active) return;
        logWarn("Pipe read error", {
          sessionId: pipe.sessionId,
          error: String(err),
        });
      }
    };

    try {
      // Use fs.watch to get notified when pipe-pane appends data
      pipe.watcher = watch(pipe.pipePath, () => readNewData());

      // Poll as fallback — fs.watch can miss events on some platforms
      pipe.pollTimer = setInterval(readNewData, 500);

      // Initial read in case data already exists
      readNewData();
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

    // Parse line into structured events
    const parser = this.parsers.get(sessionId);
    const events = parser ? parser.parseLine(line) : [];

    // Debug: write raw line and parsed events to file
    pipeLog(sessionId, line, events);

    // Notify handlers with both raw line and parsed events
    for (const handler of this.outputHandlers) {
      try {
        handler(sessionId, line, events);
      } catch (err) {
        logWarn("Output handler error", { error: String(err) });
      }
    }
  }
}
