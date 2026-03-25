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
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
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

export type OutputHandler = (sessionId: string, line: string, events: OutputEvent[]) => void;

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
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
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
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      .catch(() => {});

    // Poll every 1.5 seconds
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
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

    // Parse conversation events from new content
    const events: OutputEvent[] = [];
    if (added.length > 0) {
      parser.reset();
      for (const line of added) {
        events.push(...parser.parseLine(line));
      }
      events.push(...parser.flush());
    }

    // Also scan raw lines for status bar context/cost data that
    // extractConversation filters out. Claude Code's status bar shows
    // context usage as "NN% ❯❯❯" and optionally "Context left until auto-compact: N%".
    const statusBarEvent = this.extractStatusBarCost(newLines);
    if (statusBarEvent) {
      events.push(statusBarEvent);
    }

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

  /**
   * Extract context window usage from Claude Code's status bar.
   * Delegates to the module-level parseStatusBarCost() function.
   */
  private extractStatusBarCost(lines: string[]): OutputEvent | null {
    return parseStatusBarCost(lines);
  }

}

// ============================================================================
// Standalone cost extraction helpers
// ============================================================================

/**
 * Parse cost and context data from tmux capture-pane lines.
 *
 * Claude Code's TUI status bar shows context usage in this format:
 *   ~/code/ai/adjutant main 31% ❯❯❯
 *
 * And optionally on the right side:
 *   Context left until auto-compact: 6%
 *
 * Exported so that one-shot callers (extractCostOnce) can reuse the
 * same parsing logic without going through SessionConnector.
 */
export function parseStatusBarCost(lines: string[]): OutputEvent | null {
  // Pattern: "NN% ❯❯❯" in the status bar — this is context remaining percentage
  const STATUS_BAR = /(\d+)%\s*❯❯/;
  // Pattern: "$X.XX" — session cost from statusline script (cost.total_cost_usd)
  const COST_DOLLAR = /\$(\d+\.\d{2})/;
  // Pattern: "Context left until auto-compact: N%" — remaining context
  const CONTEXT_LEFT = /Context left[^:]*:\s*(\d+)%/;

  for (const line of lines) {
    const statusMatch = STATUS_BAR.exec(line);
    if (statusMatch) {
      const contextRemainingPercent = parseInt(statusMatch[1] ?? "0", 10);
      // Status bar shows remaining %, convert to used %
      const contextUsedPercent = 100 - contextRemainingPercent;
      // Convert to approximate token count: percent * 200k / 100
      const estimatedTokens = Math.round((contextUsedPercent / 100) * 200_000);

      // Extract dollar cost from statusline (e.g., "$1.23")
      const costMatch = COST_DOLLAR.exec(line);
      const dollarCost = costMatch ? parseFloat(costMatch[1] ?? "0") : undefined;

      // Check for remaining context on the same or nearby lines
      const leftMatch = CONTEXT_LEFT.exec(line);
      const contextLeftPercent = leftMatch ? parseInt(leftMatch[1] ?? "0", 10) : undefined;

      return {
        type: "cost_update",
        tokens: {
          input: estimatedTokens,
        },
        ...(dollarCost !== undefined ? { cost: dollarCost } : {}),
        contextPercent: contextUsedPercent,
        contextLeftPercent,
      } as OutputEvent;
    }
  }

  return null;
}

/** Result shape for extractCostOnce — flattened for easy consumption. */
export interface CostSnapshot {
  cost?: number;
  contextPercent?: number;
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/**
 * One-shot cost/context extraction from a tmux session pane.
 *
 * Runs `tmux capture-pane -p` on the given pane, parses the status bar
 * for cost and context data, and returns a snapshot. Safe to call from
 * anywhere — no side effects, no state mutation.
 *
 * @param tmuxSession - tmux session name (e.g., "adj-engineer-7")
 * @param tmuxPane    - tmux pane target (e.g., "adj-engineer-7:0.0")
 * @returns Cost snapshot or null if extraction failed or no data found
 */
export async function extractCostOnce(
  _tmuxSession: string,
  tmuxPane: string,
): Promise<CostSnapshot | null> {
  try {
    const output = await execTmuxCommand(["capture-pane", "-p", "-t", tmuxPane]);
    const lines = output.split("\n");
    const event = parseStatusBarCost(lines);
    if (event?.type !== "cost_update") return null;

    // Flatten the OutputEvent into a CostSnapshot
    const snapshot: CostSnapshot = {};
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if ("cost" in event && event.cost !== undefined) snapshot.cost = event.cost;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if ("contextPercent" in event && event.contextPercent !== undefined) {
      snapshot.contextPercent = event.contextPercent;
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if ("tokens" in event && event.tokens) {
      snapshot.tokens = {
        input: event.tokens.input ?? 0,
        output: event.tokens.output ?? 0,
        cacheRead: event.tokens.cacheRead ?? 0,
        cacheWrite: event.tokens.cacheWrite ?? 0,
      };
    }
    return snapshot;
  } catch {
    // tmux command failed (session gone, no server, etc.)
    return null;
  }
}
