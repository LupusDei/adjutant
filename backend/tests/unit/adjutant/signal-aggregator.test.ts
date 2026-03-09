// Suppress logging
vi.mock("../../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  SignalAggregator,
  type Signal,
  type SignalUrgency,
} from "../../../src/services/adjutant/signal-aggregator.js";

describe("SignalAggregator", () => {
  let aggregator: SignalAggregator;
  let onCriticalSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    aggregator = new SignalAggregator();
    onCriticalSpy = vi.fn();
    aggregator.onCritical(onCriticalSpy);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ======================================================================
  // Classification
  // ======================================================================

  describe("classification", () => {
    it("classifies build:failed as critical", () => {
      aggregator.ingest("build:failed", { agentId: "w1", exitCode: 1, errorOutput: "err", streamId: "s1" });
      expect(onCriticalSpy).toHaveBeenCalledOnce();
      const signal: Signal = onCriticalSpy.mock.calls[0]![0];
      expect(signal.urgency).toBe("critical");
      expect(signal.event).toBe("build:failed");
    });

    it("classifies mcp:agent_disconnected as critical", () => {
      aggregator.ingest("mcp:agent_disconnected", { agentId: "w1", sessionId: "s1" });
      expect(onCriticalSpy).toHaveBeenCalledOnce();
      expect(onCriticalSpy.mock.calls[0]![0].urgency).toBe("critical");
    });

    it("classifies merge:conflict as critical", () => {
      aggregator.ingest("merge:conflict", { branch: "feat", conflictFiles: ["a.ts"] });
      expect(onCriticalSpy).toHaveBeenCalledOnce();
      expect(onCriticalSpy.mock.calls[0]![0].urgency).toBe("critical");
    });

    it("classifies agent:status_changed with status 'blocked' as critical", () => {
      aggregator.ingest("agent:status_changed", { agent: "w1", status: "blocked" });
      expect(onCriticalSpy).toHaveBeenCalledOnce();
      expect(onCriticalSpy.mock.calls[0]![0].urgency).toBe("critical");
    });

    it("classifies agent:status_changed with status 'working' as context", () => {
      aggregator.ingest("agent:status_changed", { agent: "w1", status: "working" });
      expect(onCriticalSpy).not.toHaveBeenCalled();
    });

    it("classifies bead:created with priority 0 as critical (via metadata)", () => {
      aggregator.ingest("bead:created", { id: "adj-100", title: "P0 bug", status: "open", type: "bug", priority: 0 });
      expect(onCriticalSpy).toHaveBeenCalledOnce();
    });

    it("classifies bead:created with priority 1 as critical", () => {
      aggregator.ingest("bead:created", { id: "adj-101", title: "P1 task", status: "open", type: "task", priority: 1 });
      expect(onCriticalSpy).toHaveBeenCalledOnce();
    });

    it("classifies bead:created with priority 2 as context", () => {
      aggregator.ingest("bead:created", { id: "adj-102", title: "P2 task", status: "open", type: "task", priority: 2 });
      expect(onCriticalSpy).not.toHaveBeenCalled();
    });

    it("classifies bead:closed as context", () => {
      aggregator.ingest("bead:closed", { id: "adj-100", title: "done", closedAt: "2026-01-01" });
      expect(onCriticalSpy).not.toHaveBeenCalled();
    });

    it("classifies build:passed as context", () => {
      aggregator.ingest("build:passed", { agentId: "w1", streamId: "s1" });
      expect(onCriticalSpy).not.toHaveBeenCalled();
    });

    it("classifies mail:received from user to agent as context", () => {
      aggregator.ingest("mail:received", { id: "m1", from: "user", to: "engineer-1", subject: "", preview: "do X" });
      expect(onCriticalSpy).not.toHaveBeenCalled();
      const snap = aggregator.snapshot();
      expect(snap["mail:received"]).toHaveLength(1);
      expect((snap["mail:received"]![0]!.data as Record<string, unknown>).to).toBe("engineer-1");
    });

    it("classifies mail:received from user to adjutant-coordinator as context (not filtered)", () => {
      aggregator.ingest("mail:received", { id: "m2", from: "user", to: "adjutant-coordinator", subject: "", preview: "hey" });
      expect(onCriticalSpy).not.toHaveBeenCalled();
      const snap = aggregator.snapshot();
      expect(snap["mail:received"]).toHaveLength(1);
    });

    it("classifies mail:received from user to adjutant-core as context", () => {
      aggregator.ingest("mail:received", { id: "m3", from: "user", to: "adjutant-core", subject: "", preview: "hey" });
      expect(onCriticalSpy).not.toHaveBeenCalled();
    });

    it("buffers multiple user→agent messages as separate signals (unique message IDs)", () => {
      aggregator.ingest("mail:received", { id: "m1", from: "user", to: "engineer-1", subject: "", preview: "do X" });
      aggregator.ingest("mail:received", { id: "m2", from: "user", to: "engineer-2", subject: "", preview: "do Y" });
      const snap = aggregator.snapshot();
      expect(snap["mail:received"]).toHaveLength(2);
    });
  });

  // ======================================================================
  // Signal structure
  // ======================================================================

  describe("signal structure", () => {
    it("creates signals with all required fields", () => {
      aggregator.ingest("build:failed", { agentId: "w1", exitCode: 1, errorOutput: "err", streamId: "s1" });
      const signal: Signal = onCriticalSpy.mock.calls[0]![0];
      expect(signal.id).toBeDefined();
      expect(typeof signal.id).toBe("string");
      expect(signal.event).toBe("build:failed");
      expect(signal.data).toEqual({ agentId: "w1", exitCode: 1, errorOutput: "err", streamId: "s1" });
      expect(signal.urgency).toBe("critical");
      expect(signal.timestamp).toBeInstanceOf(Date);
    });
  });

  // ======================================================================
  // snapshot() and drain()
  // ======================================================================

  describe("snapshot()", () => {
    it("returns accumulated context signals grouped by event", () => {
      aggregator.ingest("build:passed", { agentId: "w1", streamId: "s1" });
      aggregator.ingest("build:passed", { agentId: "w2", streamId: "s2" });
      aggregator.ingest("bead:closed", { id: "adj-100", title: "done", closedAt: "2026-01-01" });

      const snap = aggregator.snapshot();
      expect(snap["build:passed"]).toHaveLength(2);
      expect(snap["bead:closed"]).toHaveLength(1);
    });

    it("does NOT drain the buffer", () => {
      aggregator.ingest("build:passed", { agentId: "w1", streamId: "s1" });
      aggregator.snapshot();
      const snap2 = aggregator.snapshot();
      expect(snap2["build:passed"]).toHaveLength(1);
    });

    it("does not include critical signals", () => {
      aggregator.ingest("build:failed", { agentId: "w1", exitCode: 1, errorOutput: "err", streamId: "s1" });
      const snap = aggregator.snapshot();
      expect(snap["build:failed"]).toBeUndefined();
    });
  });

  describe("drain()", () => {
    it("returns and clears accumulated context signals", () => {
      aggregator.ingest("build:passed", { agentId: "w1", streamId: "s1" });
      aggregator.ingest("bead:closed", { id: "adj-100", title: "done", closedAt: "2026-01-01" });

      const drained = aggregator.drain();
      expect(drained["build:passed"]).toHaveLength(1);
      expect(drained["bead:closed"]).toHaveLength(1);

      // Buffer is now empty
      const snap = aggregator.snapshot();
      expect(Object.keys(snap)).toHaveLength(0);
    });
  });

  // ======================================================================
  // onCritical callback
  // ======================================================================

  describe("onCritical", () => {
    it("fires callback with the critical signal", () => {
      aggregator.ingest("build:failed", { agentId: "w1", exitCode: 1, errorOutput: "err", streamId: "s1" });
      expect(onCriticalSpy).toHaveBeenCalledOnce();
      const signal: Signal = onCriticalSpy.mock.calls[0]![0];
      expect(signal.event).toBe("build:failed");
    });

    it("supports multiple callbacks", () => {
      const spy2 = vi.fn();
      aggregator.onCritical(spy2);
      aggregator.ingest("build:failed", { agentId: "w1", exitCode: 1, errorOutput: "err", streamId: "s1" });
      expect(onCriticalSpy).toHaveBeenCalledOnce();
      expect(spy2).toHaveBeenCalledOnce();
    });

    it("does not break ingestion if callback throws", () => {
      const throwingSpy = vi.fn(() => { throw new Error("boom"); });
      const spy2 = vi.fn();
      // Replace callbacks with throwing one first, then a normal one
      aggregator = new SignalAggregator();
      aggregator.onCritical(throwingSpy);
      aggregator.onCritical(spy2);
      aggregator.ingest("build:failed", { agentId: "w1", exitCode: 1, errorOutput: "err", streamId: "s1" });
      expect(throwingSpy).toHaveBeenCalledOnce();
      expect(spy2).toHaveBeenCalledOnce();
    });
  });

  // ======================================================================
  // Deduplication (adj-054.1.2)
  // ======================================================================

  describe("deduplication", () => {
    it("collapses same event+source within 30s into one signal", () => {
      aggregator.ingest("build:passed", { agentId: "w1", streamId: "s1" });
      // Advance 10s — within dedup window
      vi.advanceTimersByTime(10_000);
      aggregator.ingest("build:passed", { agentId: "w1", streamId: "s2" });

      const snap = aggregator.snapshot();
      expect(snap["build:passed"]).toHaveLength(1);
      expect(snap["build:passed"]![0]!.count).toBe(2);
      // Data should be updated to latest
      expect((snap["build:passed"]![0]!.data as Record<string, unknown>).streamId).toBe("s2");
    });

    it("does NOT dedup different sources", () => {
      aggregator.ingest("build:passed", { agentId: "w1", streamId: "s1" });
      aggregator.ingest("build:passed", { agentId: "w2", streamId: "s2" });

      const snap = aggregator.snapshot();
      expect(snap["build:passed"]).toHaveLength(2);
    });

    it("creates new signal after dedup window expires", () => {
      aggregator.ingest("build:passed", { agentId: "w1", streamId: "s1" });
      // Advance 31s — past dedup window
      vi.advanceTimersByTime(31_000);
      aggregator.ingest("build:passed", { agentId: "w1", streamId: "s2" });

      const snap = aggregator.snapshot();
      // Both signals should exist (different dedup windows)
      expect(snap["build:passed"]).toHaveLength(1);
      // The old one was replaced because same key — the new one has count 1
      expect(snap["build:passed"]![0]!.count).toBe(1);
    });
  });

  // ======================================================================
  // Auto-expiry (adj-054.1.2)
  // ======================================================================

  describe("auto-expiry", () => {
    it("prunes signals older than 30 minutes on ingest", () => {
      aggregator.ingest("build:passed", { agentId: "w1", streamId: "s1" });
      expect(aggregator.bufferSize()).toBe(1);

      // Advance 31 minutes
      vi.advanceTimersByTime(31 * 60 * 1000);

      // Next ingest triggers pruning
      aggregator.ingest("bead:closed", { id: "adj-100", title: "done", closedAt: "2026-01-01" });

      const snap = aggregator.snapshot();
      expect(snap["build:passed"]).toBeUndefined();
      expect(snap["bead:closed"]).toHaveLength(1);
      expect(aggregator.bufferSize()).toBe(1);
    });

    it("keeps signals younger than 30 minutes", () => {
      aggregator.ingest("build:passed", { agentId: "w1", streamId: "s1" });
      // Advance 29 minutes — just under expiry
      vi.advanceTimersByTime(29 * 60 * 1000);
      aggregator.ingest("bead:closed", { id: "adj-100", title: "done", closedAt: "2026-01-01" });

      expect(aggregator.bufferSize()).toBe(2);
    });
  });

  // ======================================================================
  // Metrics (adj-054.1.2)
  // ======================================================================

  describe("metrics", () => {
    it("bufferSize() returns count of buffered context signals", () => {
      expect(aggregator.bufferSize()).toBe(0);
      aggregator.ingest("build:passed", { agentId: "w1", streamId: "s1" });
      expect(aggregator.bufferSize()).toBe(1);
      aggregator.ingest("bead:closed", { id: "adj-100", title: "done", closedAt: "2026-01-01" });
      expect(aggregator.bufferSize()).toBe(2);
    });

    it("bufferSize() does not count critical signals", () => {
      aggregator.ingest("build:failed", { agentId: "w1", exitCode: 1, errorOutput: "err", streamId: "s1" });
      expect(aggregator.bufferSize()).toBe(0);
    });

    it("signalsPerMinute() counts events over last 5 minutes", () => {
      // Ingest 10 signals
      for (let i = 0; i < 10; i++) {
        aggregator.ingest("build:passed", { agentId: `w${i}`, streamId: `s${i}` });
      }
      // With fake timers at 0, elapsed is clamped to 1 minute min
      // so 10 signals / 1 min (minimum) but actually over 5 min window
      const rate = aggregator.signalsPerMinute();
      expect(rate).toBeGreaterThan(0);
      expect(rate).toBeLessThanOrEqual(10);
    });
  });

  // ======================================================================
  // Edge cases (adj-054.7 — QA)
  // ======================================================================

  describe("edge cases", () => {
    it("handles null data without crashing", () => {
      // null data should classify as context and not crash dedupKey
      expect(() => {
        aggregator.ingest("build:passed", null);
      }).not.toThrow();
      expect(aggregator.bufferSize()).toBe(1);
    });

    it("handles undefined data without crashing", () => {
      expect(() => {
        aggregator.ingest("build:passed", undefined);
      }).not.toThrow();
    });

    it("handles primitive data without crashing", () => {
      expect(() => {
        aggregator.ingest("build:passed", 42);
      }).not.toThrow();
      expect(() => {
        aggregator.ingest("build:passed", "string-data");
      }).not.toThrow();
    });

    it("classifies agent:status_changed with null data as context (not crash)", () => {
      expect(() => {
        aggregator.ingest("agent:status_changed", null);
      }).not.toThrow();
      expect(onCriticalSpy).not.toHaveBeenCalled();
    });

    it("classifies bead:created with non-numeric priority as context", () => {
      aggregator.ingest("bead:created", { id: "adj-100", priority: "high" });
      expect(onCriticalSpy).not.toHaveBeenCalled();
    });

    it("classifies bead:created with missing priority as context", () => {
      aggregator.ingest("bead:created", { id: "adj-100" });
      expect(onCriticalSpy).not.toHaveBeenCalled();
    });

    it("prunes ingestTimestamps to prevent memory leak during heavy traffic", () => {
      // Ingest 200 signals to trigger timestamp pruning
      for (let i = 0; i < 200; i++) {
        aggregator.ingest("build:passed", { agentId: `w${i}`, streamId: `s${i}` });
      }
      // Advance 6 minutes so all timestamps are old
      vi.advanceTimersByTime(6 * 60 * 1000);
      // Ingest more to trigger pruning of old timestamps
      for (let i = 0; i < 200; i++) {
        aggregator.ingest("build:passed", { agentId: `w${i + 200}`, streamId: `s${i + 200}` });
      }
      // signalsPerMinute should only count recent ones
      const rate = aggregator.signalsPerMinute();
      // Should reflect ~200 signals in the last 5 minutes, not 400
      expect(rate).toBeLessThan(60); // 200 / ~5min = ~40/min
    });

    it("snapshot returns defensive copies (modifying result does not affect buffer)", () => {
      aggregator.ingest("build:passed", { agentId: "w1", streamId: "s1" });
      const snap = aggregator.snapshot();
      // Modify the snapshot
      snap["build:passed"]![0]!.count = 999;
      // Original buffer should be unaffected
      const snap2 = aggregator.snapshot();
      expect(snap2["build:passed"]![0]!.count).toBe(1);
    });
  });
});
