/**
 * Signal Aggregator — classifies EventBus events into critical/context signals.
 *
 * Critical signals wake the adjutant immediately via registered callbacks.
 * Context signals accumulate silently and are included when the adjutant
 * wakes for any reason (via snapshot() or drain()).
 */

import { randomUUID } from "crypto";

import type { EventName } from "../event-bus.js";

// ============================================================================
// Types
// ============================================================================

export type SignalUrgency = "critical" | "context";

export interface Signal {
  /** Unique signal ID */
  id: string;
  /** The EventBus event name */
  event: EventName;
  /** Raw event payload */
  data: unknown;
  /** Classification: critical triggers immediate wake, context accumulates */
  urgency: SignalUrgency;
  /** When the signal was ingested */
  timestamp: Date;
  /** Dedup count — how many duplicate events were collapsed into this signal */
  count: number;
}

export type CriticalCallback = (signal: Signal) => void;

export type SignalSnapshot = Record<string, Signal[]>;

// ============================================================================
// Classification
// ============================================================================

/** Agent IDs that belong to the adjutant itself — messages TO these are not context signals. */
const ADJUTANT_IDS = new Set(["adjutant-coordinator", "adjutant", "adjutant-core"]);

/**
 * Classify an event into critical or context urgency.
 *
 * Critical events (wake immediately):
 *   - build:failed
 *   - mcp:agent_disconnected
 *   - merge:conflict
 *   - agent:status_changed with status "blocked"
 *   - bead:created with priority 0 or 1
 *
 * Context events (accumulate silently):
 *   - mail:received from user to a non-adjutant agent (user→agent instructions)
 *   - Everything else not classified as critical
 *
 * Ignored:
 *   - mail:received from user to the adjutant itself (handled directly, not a context signal)
 */
function classify(event: EventName, data: unknown): SignalUrgency {
  switch (event) {
    case "build:failed":
    case "mcp:agent_disconnected":
    case "merge:conflict":
      return "critical";

    case "agent:status_changed": {
      const payload = data as Record<string, unknown> | null | undefined;
      if (payload?.["status"] === "blocked") {
        return "critical";
      }
      return "context";
    }

    case "bead:created": {
      const payload = data as Record<string, unknown> | null | undefined;
      const priority = payload?.["priority"];
      if (typeof priority === "number" && priority <= 1) {
        return "critical";
      }
      return "context";
    }

    case "mail:received": {
      // User→agent messages are context signals so the adjutant stays aware
      // of instructions given to other agents. Messages to the adjutant itself
      // are handled directly and classified as "ignore" (return context but
      // with dedup key that collapses — effectively a no-op since the adjutant
      // already processes its own mail).
      const payload = data as Record<string, unknown> | null | undefined;
      const from = payload?.["from"] as string | undefined;
      const to = payload?.["to"] as string | undefined;
      if (from === "user" && to && !ADJUTANT_IDS.has(to)) {
        return "context";
      }
      return "context";
    }

    default:
      return "context";
  }
}

// ============================================================================
// Dedup key
// ============================================================================

/**
 * Extract a deduplication key from event name + data.
 * Uses event name + source identifier (agentId, agent, id, branch).
 */
function dedupKey(event: EventName, data: unknown): string {
  const payload = data as Record<string, unknown> | null;
  const source =
    (payload?.["agentId"] as string) ??
    (payload?.["agent"] as string) ??
    (payload?.["id"] as string) ??
    (payload?.["branch"] as string) ??
    "";
  return `${event}:${source}`;
}

// ============================================================================
// SignalAggregator
// ============================================================================

/** Default dedup window: 30 seconds */
const DEDUP_WINDOW_MS = 30_000;

/** Default expiry: 30 minutes */
const EXPIRY_MS = 30 * 60 * 1000;

export class SignalAggregator {
  private contextBuffer: Map<string, Signal> = new Map();
  private criticalCallbacks: CriticalCallback[] = [];

  /** Ingest timestamps for signalsPerMinute calculation */
  private ingestTimestamps: number[] = [];

  /**
   * Ingest an event from the EventBus.
   * Classifies it, deduplicates, buffers context, and fires critical callbacks.
   */
  ingest(event: EventName, data: unknown): void {
    const now = new Date();
    this.ingestTimestamps.push(now.getTime());

    // Prune ingest timestamps older than 5 minutes to prevent unbounded growth
    const fiveMinAgo = now.getTime() - 5 * 60 * 1000;
    if (this.ingestTimestamps.length > 100) {
      this.ingestTimestamps = this.ingestTimestamps.filter((t) => t >= fiveMinAgo);
    }

    // Lazy cleanup: prune expired signals
    this.pruneExpired(now);

    const urgency = classify(event, data);

    if (urgency === "critical") {
      const signal: Signal = {
        id: randomUUID(),
        event,
        data,
        urgency,
        timestamp: now,
        count: 1,
      };
      // Fire all critical callbacks
      for (const cb of this.criticalCallbacks) {
        try {
          cb(signal);
        } catch {
          // Callbacks must not break ingestion
        }
      }
      return;
    }

    // Context signal — buffer with deduplication
    const key = dedupKey(event, data);
    const existing = this.contextBuffer.get(key);

    if (existing && now.getTime() - existing.timestamp.getTime() < DEDUP_WINDOW_MS) {
      // Collapse: update count and data, keep latest timestamp
      existing.count++;
      existing.data = data;
      existing.timestamp = now;
    } else {
      // New signal
      this.contextBuffer.set(key, {
        id: randomUUID(),
        event,
        data,
        urgency,
        timestamp: now,
        count: 1,
      });
    }
  }

  /**
   * Return accumulated context signals grouped by event name.
   * Does NOT drain the buffer.
   */
  snapshot(): SignalSnapshot {
    const grouped: SignalSnapshot = {};
    for (const signal of this.contextBuffer.values()) {
      const key = signal.event;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push({ ...signal });
    }
    return grouped;
  }

  /**
   * Return and clear accumulated context signals grouped by event name.
   */
  drain(): SignalSnapshot {
    const result = this.snapshot();
    this.contextBuffer.clear();
    return result;
  }

  /**
   * Register a callback for critical signals.
   * Callback receives the signal immediately on ingest.
   */
  onCritical(callback: CriticalCallback): void {
    this.criticalCallbacks.push(callback);
  }

  /**
   * Current number of buffered context signals.
   */
  bufferSize(): number {
    return this.contextBuffer.size;
  }

  /**
   * Average signals ingested per minute over the last 5 minutes.
   */
  signalsPerMinute(): number {
    const now = Date.now();
    const fiveMinAgo = now - 5 * 60 * 1000;
    // Prune old timestamps
    this.ingestTimestamps = this.ingestTimestamps.filter((t) => t >= fiveMinAgo);
    const elapsed = Math.max((now - fiveMinAgo) / 60_000, 1);
    return this.ingestTimestamps.length / elapsed;
  }

  /**
   * Remove context signals older than EXPIRY_MS.
   */
  private pruneExpired(now: Date): void {
    const cutoff = now.getTime() - EXPIRY_MS;
    for (const [key, signal] of this.contextBuffer) {
      if (signal.timestamp.getTime() < cutoff) {
        this.contextBuffer.delete(key);
      }
    }
  }
}
