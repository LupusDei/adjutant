/**
 * OutputThrottle — rate-limits session output for slow WebSocket clients.
 *
 * Buffers output lines and flushes at a configurable interval.
 * Prevents overwhelming mobile clients with rapid terminal output.
 * Also supports persistent log files for full session history.
 */

import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { logWarn } from "../utils/index.js";

// ============================================================================
// Types
// ============================================================================

export interface ThrottleConfig {
  /** Flush interval in milliseconds (default: 100ms) */
  flushIntervalMs?: number;
  /** Max lines to batch in a single flush (default: 50) */
  maxBatchSize?: number;
  /** Enable persistent log files (default: true) */
  persistLogs?: boolean;
  /** Directory for persistent logs */
  logDir?: string;
}

export interface OutputBatch {
  sessionId: string;
  lines: string[];
  timestamp: number;
}

type FlushCallback = (batch: OutputBatch) => void;

// ============================================================================
// OutputThrottle
// ============================================================================

export class OutputThrottle {
  private buffers = new Map<string, string[]>();
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private callbacks: FlushCallback[] = [];
  private flushIntervalMs: number;
  private maxBatchSize: number;
  private persistLogs: boolean;
  private logDir: string;

  constructor(config?: ThrottleConfig) {
    this.flushIntervalMs = config?.flushIntervalMs ?? 100;
    this.maxBatchSize = config?.maxBatchSize ?? 50;
    this.persistLogs = config?.persistLogs ?? true;
    this.logDir = config?.logDir ?? join(homedir(), ".adjutant", "logs");

    if (this.persistLogs && !existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Register a callback that receives batched output.
   */
  onFlush(callback: FlushCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Buffer a line of output for a session.
   * Lines are flushed periodically or when the batch is full.
   */
  push(sessionId: string, line: string): void {
    // Initialize buffer if needed
    if (!this.buffers.has(sessionId)) {
      this.buffers.set(sessionId, []);
      this.startTimer(sessionId);
    }

    const buffer = this.buffers.get(sessionId)!;
    buffer.push(line);

    // Persist to log file
    if (this.persistLogs) {
      this.appendToLog(sessionId, line);
    }

    // Flush immediately if batch is full
    if (buffer.length >= this.maxBatchSize) {
      this.flush(sessionId);
    }
  }

  /**
   * Flush buffered output for a session immediately.
   */
  flush(sessionId: string): void {
    const buffer = this.buffers.get(sessionId);
    if (!buffer || buffer.length === 0) return;

    const batch: OutputBatch = {
      sessionId,
      lines: [...buffer],
      timestamp: Date.now(),
    };

    buffer.length = 0;

    for (const cb of this.callbacks) {
      try {
        cb(batch);
      } catch (err) {
        logWarn("Flush callback error", { error: String(err) });
      }
    }
  }

  /**
   * Flush all sessions and stop timers.
   */
  flushAll(): void {
    for (const sessionId of this.buffers.keys()) {
      this.flush(sessionId);
    }
  }

  /**
   * Stop tracking a session (flush remaining, stop timer, close log).
   */
  remove(sessionId: string): void {
    this.flush(sessionId);
    this.stopTimer(sessionId);
    this.buffers.delete(sessionId);
  }

  /**
   * Stop all timers and clean up.
   */
  shutdown(): void {
    this.flushAll();
    for (const sessionId of this.timers.keys()) {
      this.stopTimer(sessionId);
    }
    this.buffers.clear();
  }

  /**
   * Get the log file path for a session.
   */
  getLogPath(sessionId: string): string {
    return join(this.logDir, `session-${sessionId}.log`);
  }

  /**
   * Get active session count.
   */
  get activeCount(): number {
    return this.buffers.size;
  }

  /**
   * Get pending line count for a session.
   */
  getPendingCount(sessionId: string): number {
    return this.buffers.get(sessionId)?.length ?? 0;
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private startTimer(sessionId: string): void {
    if (this.timers.has(sessionId)) return;

    const timer = setInterval(() => {
      this.flush(sessionId);
    }, this.flushIntervalMs);

    // Don't prevent Node.js from exiting
    if (timer.unref) timer.unref();

    this.timers.set(sessionId, timer);
  }

  private stopTimer(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(sessionId);
    }
  }

  private appendToLog(sessionId: string, line: string): void {
    try {
      const logPath = this.getLogPath(sessionId);
      appendFileSync(logPath, line + "\n", "utf8");
    } catch (err) {
      // Don't spam logs about log failures
      if (!this.logErrorSuppressed) {
        logWarn("Failed to write session log", {
          sessionId,
          error: String(err),
        });
        this.logErrorSuppressed = true;
      }
    }
  }

  private logErrorSuppressed = false;
}
