/**
 * Streaming bridge for Adjutant.
 *
 * Bridges between agent streaming output (file-based) and WebSocket clients.
 *
 * Convention:
 * - Agents write streaming tokens to .beads/streams/{stream-id}.jsonl
 * - Each line: {"token": "text", "seq": N} or {"done": true, "messageId": "adj-xyz"}
 * - Backend watches .beads/streams/ via fs.watch()
 * - Relays stream tokens over WebSocket to subscribed clients
 * - Cleans up completed stream files
 */

import { watch, unlinkSync, mkdirSync, existsSync, readdirSync, statSync, createReadStream } from "fs";
import type { FSWatcher } from "fs";
import { join, basename } from "path";
import { createInterface } from "readline";
import { getEventBus } from "./event-bus.js";
import { wsBroadcast } from "./ws-server.js";
import { resolveWorkspaceRoot } from "./workspace/index.js";
import { logInfo } from "../utils/index.js";

// ============================================================================
// Types
// ============================================================================

interface StreamToken {
  token?: string;
  seq?: number;
  done?: boolean;
  messageId?: string;
  error?: string;
}

interface ActiveStream {
  streamId: string;
  filePath: string;
  /** Number of lines already processed */
  linesRead: number;
  /** Whether the stream is complete */
  complete: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const STREAMS_DIR_NAME = "streams";
const CLEANUP_DELAY_MS = 5_000; // Delay before deleting completed stream files
const STALE_CHECK_INTERVAL_MS = 60_000; // Check for stale streams every minute
const STALE_STREAM_AGE_MS = 5 * 60_000; // Streams older than 5 minutes are stale

// ============================================================================
// State
// ============================================================================

let watcher: FSWatcher | null = null;
let staleCheckTimer: ReturnType<typeof setInterval> | null = null;
const activeStreams = new Map<string, ActiveStream>();

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get the streams directory path.
 */
function getStreamsDir(): string {
  const root = resolveWorkspaceRoot();
  return join(root, ".beads", STREAMS_DIR_NAME);
}

/**
 * Ensure the streams directory exists.
 */
function ensureStreamsDir(): string {
  const dir = getStreamsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Extract stream ID from filename.
 * "abc-123.jsonl" → "abc-123"
 */
function streamIdFromFile(filename: string): string | null {
  if (!filename.endsWith(".jsonl")) return null;
  return basename(filename, ".jsonl");
}

/**
 * Process new lines from a stream file.
 */
async function processStreamFile(stream: ActiveStream): Promise<void> {
  try {
    const rl = createInterface({
      input: createReadStream(stream.filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    let lineNum = 0;
    for await (const line of rl) {
      lineNum++;
      // Skip already-processed lines
      if (lineNum <= stream.linesRead) continue;

      const trimmed = line.trim();
      if (!trimmed) continue;

      let token: StreamToken;
      try {
        token = JSON.parse(trimmed) as StreamToken;
      } catch {
        continue; // Skip malformed lines
      }

      stream.linesRead = lineNum;

      if (token.done) {
        // Stream complete
        stream.complete = true;

        wsBroadcast({
          type: "stream_end",
          streamId: stream.streamId,
          messageId: token.messageId,
          body: "", // Full body available via REST
          done: true,
        });

        getEventBus().emit("stream:status", {
          streamId: stream.streamId,
          agent: "",
          state: "completed",
        });

        // Schedule cleanup
        setTimeout(() => cleanupStream(stream.streamId), CLEANUP_DELAY_MS);
      } else if (token.error) {
        // Stream error
        stream.complete = true;

        wsBroadcast({
          type: "error",
          code: "stream_error",
          message: token.error,
          relatedId: stream.streamId,
        });

        getEventBus().emit("stream:status", {
          streamId: stream.streamId,
          agent: "",
          state: "error",
        });

        setTimeout(() => cleanupStream(stream.streamId), CLEANUP_DELAY_MS);
      } else if (token.token !== undefined) {
        // Regular token
        wsBroadcast({
          type: "stream_token",
          streamId: stream.streamId,
          seq: token.seq,
          token: token.token,
          done: false,
        });
      }
    }
  } catch (err) {
    // File might be gone or being written — that's OK
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logInfo("stream file read error", {
        streamId: stream.streamId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Clean up a completed stream file.
 */
function cleanupStream(streamId: string): void {
  const stream = activeStreams.get(streamId);
  if (!stream) return;

  activeStreams.delete(streamId);

  try {
    unlinkSync(stream.filePath);
  } catch {
    // File already gone — that's fine
  }
}

/**
 * Handle a new or changed file in the streams directory.
 */
function handleStreamFileChange(filename: string): void {
  const streamId = streamIdFromFile(filename);
  if (!streamId) return;

  const streamsDir = getStreamsDir();
  const filePath = join(streamsDir, filename);

  let stream = activeStreams.get(streamId);
  if (!stream) {
    stream = {
      streamId,
      filePath,
      linesRead: 0,
      complete: false,
    };
    activeStreams.set(streamId, stream);

    getEventBus().emit("stream:status", {
      streamId,
      agent: "",
      state: "started",
    });

    logInfo("stream started", { streamId });
  }

  if (!stream.complete) {
    processStreamFile(stream);
  }
}

/**
 * Clean up stale streams that may have been abandoned.
 */
function cleanupStaleStreams(): void {
  const streamsDir = getStreamsDir();
  if (!existsSync(streamsDir)) return;

  try {
    const files = readdirSync(streamsDir);
    const now = Date.now();

    for (const file of files) {
      const streamId = streamIdFromFile(file);
      if (!streamId) continue;

      const stream = activeStreams.get(streamId);
      if (stream?.complete) continue;

      // Check file age via stat
      try {
        const { mtimeMs } = statSync(join(streamsDir, file));
        if (now - mtimeMs > STALE_STREAM_AGE_MS) {
          logInfo("cleaning stale stream", { streamId });
          cleanupStream(streamId);
          try { unlinkSync(join(streamsDir, file)); } catch { /* ignore */ }
        }
      } catch {
        // File gone, ignore
      }
    }
  } catch {
    // Directory gone, ignore
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the streaming bridge.
 * Starts watching .beads/streams/ for new stream files.
 */
export function initStreamingBridge(): void {
  if (watcher) return;

  const streamsDir = ensureStreamsDir();

  // Process any existing stream files on startup
  try {
    const existing = readdirSync(streamsDir);
    for (const file of existing) {
      handleStreamFileChange(file);
    }
  } catch {
    // Empty or missing — that's fine
  }

  // Watch for new/changed files
  try {
    watcher = watch(streamsDir, (eventType, filename) => {
      if (filename && (eventType === "rename" || eventType === "change")) {
        handleStreamFileChange(filename);
      }
    });

    watcher.on("error", (err) => {
      logInfo("streams watcher error", { error: err.message });
    });
  } catch (err) {
    logInfo("failed to start streams watcher", {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Periodic stale stream cleanup
  staleCheckTimer = setInterval(cleanupStaleStreams, STALE_CHECK_INTERVAL_MS);

  logInfo("streaming bridge initialized", { dir: streamsDir });
}

/**
 * Get active stream count.
 */
export function getActiveStreamCount(): number {
  return activeStreams.size;
}

/**
 * Shut down the streaming bridge.
 */
export function closeStreamingBridge(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (staleCheckTimer) {
    clearInterval(staleCheckTimer);
    staleCheckTimer = null;
  }
  activeStreams.clear();
  logInfo("streaming bridge closed");
}
