/**
 * SessionConnector — attaches to tmux sessions via pipe-pane for output capture.
 *
 * Uses `tmux pipe-pane` to stream output from a tmux pane to a FIFO,
 * then reads the FIFO and broadcasts lines to connected clients.
 */

import { execFile } from "child_process";
import { mkdirSync, existsSync, unlinkSync, writeFileSync, appendFileSync } from "fs";
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

function pipeTrace(msg: string): void {
  try {
    const dir = dirname(PIPE_LOG_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString();
    appendFileSync(PIPE_LOG_PATH, `[${ts}] TRACE ${msg}\n`);
  } catch {
    // Never let debug logging break the pipeline
  }
}

// pipeLog removed — structured events now come from capture-pane polling

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
  capturePollTimer?: ReturnType<typeof setInterval>;
  lastCaptureLines: string[];   // split lines of last capture for diffing
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
    pipeTrace(`attach called sid=${sessionId}`);
    const session = this.registry.get(sessionId);
    if (!session) {
      pipeTrace(`attach FAIL: session not found sid=${sessionId}`);
      logWarn("Cannot attach: session not found", { sessionId });
      return false;
    }

    if (this.pipes.has(sessionId)) {
      pipeTrace(`attach SKIP: already attached sid=${sessionId}`);
      logWarn("Already attached to session", { sessionId });
      return true;
    }

    const pipePath = join(this.pipeDir, `session-${sessionId}.pipe`);
    pipeTrace(`attach pane=${session.tmuxPane} pipePath=${pipePath}`);

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
      pipeTrace(`pipe-pane started for pane=${session.tmuxPane}`);

      const pipe: PipeState = {
        sessionId,
        pipePath,
        active: true,
        lastCaptureLines: [],
      };
      this.pipes.set(sessionId, pipe);
      this.parsers.set(sessionId, new OutputParser());

      session.pipeActive = true;
      logInfo("Pipe attached", { sessionId, tmuxPane: session.tmuxPane });

      // Start capture-pane polling (single output path)
      this.startCapturePoll(pipe);

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
    if (pipe.capturePollTimer) clearInterval(pipe.capturePollTimer);
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

  /**
   * Poll `tmux capture-pane -p` to get clean rendered text.
   * Diff against last snapshot, parse new content into events.
   */
  private startCapturePoll(pipe: PipeState): void {
    const session = this.registry.get(pipe.sessionId);
    if (!session) return;

    const tmuxPane = session.tmuxPane;
    pipeTrace(`startCapturePoll sid=${pipe.sessionId} pane=${tmuxPane}`);

    // Take initial snapshot
    execTmuxCommand(["capture-pane", "-t", tmuxPane, "-p", "-S", "-500"])
      .then((output) => {
        pipe.lastCaptureLines = output.split("\n");
        pipeTrace(`initial capture: ${pipe.lastCaptureLines.length} lines`);
      })
      .catch(() => {});

    // Poll every 1.5 seconds
    pipe.capturePollTimer = setInterval(async () => {
      if (!pipe.active) return;

      try {
        const output = await execTmuxCommand([
          "capture-pane", "-t", tmuxPane, "-p", "-S", "-500",
        ]);

        const newLines = output.split("\n");
        const events = this.diffAndParse(pipe, newLines);

        pipe.lastCaptureLines = newLines;

        if (events.length > 0) {
          pipeTrace(`capture-poll: ${events.length} events from diff`);
          for (const evt of events) {
            pipeTrace(`  EVENT: ${JSON.stringify(evt).slice(0, 200)}`);
          }
          // Emit events with empty raw line (events-only delivery)
          for (const handler of this.outputHandlers) {
            try {
              handler(pipe.sessionId, "", events);
            } catch (err) {
              logWarn("Output handler error (capture)", { error: String(err) });
            }
          }
        }
      } catch {
        // tmux pane might be gone
      }
    }, 1500);
  }

  /**
   * Diff new capture lines against last snapshot and parse new content.
   * Only parses lines in the conversation area (between separators).
   *
   * Uses suffix-matching: find the longest suffix of old conversation lines
   * that appears as a prefix of the new conversation lines, then only parse
   * lines after that overlap. This avoids the fragile Set-based approach
   * which re-detected content when the pane scrolled.
   */
  private diffAndParse(pipe: PipeState, newLines: string[]): OutputEvent[] {
    const parser = this.parsers.get(pipe.sessionId);
    if (!parser) return [];

    const oldContent = this.extractConversation(pipe.lastCaptureLines);
    const newContent = this.extractConversation(newLines);

    // Find the overlap: the longest suffix of oldContent that matches
    // a prefix of newContent. Start from the full old content and shrink.
    let overlapLen = 0;
    const maxOverlap = Math.min(oldContent.length, newContent.length);
    for (let tryLen = maxOverlap; tryLen > 0; tryLen--) {
      const oldSuffix = oldContent.slice(oldContent.length - tryLen);
      let match = true;
      for (let i = 0; i < tryLen; i++) {
        if (oldSuffix[i] !== newContent[i]) {
          match = false;
          break;
        }
      }
      if (match) {
        overlapLen = tryLen;
        break;
      }
    }

    // Lines after the overlap are genuinely new
    const added = newContent.slice(overlapLen);
    if (added.length === 0) return [];

    // Reset parser for a fresh parse of the new content
    parser.reset();
    const events: OutputEvent[] = [];
    for (const line of added) {
      events.push(...parser.parseLine(line));
    }
    events.push(...parser.flush());

    return events;
  }

  /**
   * Extract conversation lines from a capture-pane snapshot.
   *
   * In Claude Code's TUI:
   *   ❯ user input
   *   ⏺ agent message (or tool use)
   *     indented continuation lines
   *
   * We collect ❯/⏺ lines and their indented continuations.
   * Everything else (separators, shell prompt, banner, spinner) is skipped.
   */
  private extractConversation(lines: string[]): string[] {
    const SEP = /^[─━═]{10,}/;
    const CHROME = /^\s*(~?\/?[\w/.-]*\s+\d*%?\s*❯❯|⏵⏵|Update available|You've used|▐▛|▝▜|▘▘)/;
    const result: string[] = [];
    let inConversation = false;

    for (const line of lines) {
      const trimmed = line.trimEnd();

      // Skip empty lines, separators, and TUI chrome
      if (trimmed.length === 0) continue;
      if (SEP.test(trimmed)) continue;
      if (CHROME.test(trimmed)) continue;

      // Conversation lines: ❯ (user), ⏺ (agent), or indented continuation
      if (/^[❯⏺]/.test(trimmed)) {
        inConversation = true;
        result.push(trimmed);
      } else if (inConversation && /^\s{2,}/.test(line)) {
        // Indented continuation line (agent multi-line response)
        result.push(trimmed);
      } else {
        // Something else — not conversation (banner, startup text, etc.)
        inConversation = false;
      }
    }

    return result;
  }

}
