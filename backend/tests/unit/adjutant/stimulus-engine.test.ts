// Suppress logging
vi.mock("../../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  StimulusEngine,
  buildSituationPrompt,
  buildBootstrapPrompt,
  type WakeCallback,
  type WakeReason,
} from "../../../src/services/adjutant/stimulus-engine.js";
import type { Signal } from "../../../src/services/adjutant/signal-aggregator.js";
import type { SignalSnapshot } from "../../../src/services/adjutant/signal-aggregator.js";

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: "sig-1",
    event: "build:failed",
    data: { agentId: "w1", exitCode: 1, errorOutput: "err", streamId: "s1" },
    urgency: "critical",
    timestamp: new Date(),
    count: 1,
    ...overrides,
  };
}

describe("StimulusEngine", () => {
  let engine: StimulusEngine;
  let wakeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    engine = new StimulusEngine();
    wakeSpy = vi.fn();
    engine.onWake(wakeSpy);
  });

  afterEach(() => {
    engine.destroy();
    vi.useRealTimers();
  });

  // ======================================================================
  // Critical signal wake
  // ======================================================================

  describe("handleCriticalSignal", () => {
    it("fires wake callback with critical signal reason", () => {
      const signal = makeSignal();
      engine.handleCriticalSignal(signal);
      expect(wakeSpy).toHaveBeenCalledOnce();
      const reason: WakeReason = wakeSpy.mock.calls[0]![0];
      expect(reason.type).toBe("critical");
      expect(reason.signal).toBe(signal);
    });

    it("respects 90-second cooldown between wakes", () => {
      engine.handleCriticalSignal(makeSignal({ id: "s1" }));
      expect(wakeSpy).toHaveBeenCalledTimes(1);

      // Second signal within cooldown — should not fire immediately
      engine.handleCriticalSignal(makeSignal({ id: "s2" }));
      expect(wakeSpy).toHaveBeenCalledTimes(1);

      // Advance past cooldown
      vi.advanceTimersByTime(91_000);
      expect(wakeSpy).toHaveBeenCalledTimes(2);
      const reason: WakeReason = wakeSpy.mock.calls[1]![0];
      expect(reason.type).toBe("critical");
    });

    it("queues multiple signals during cooldown and fires once on expiry", () => {
      engine.handleCriticalSignal(makeSignal({ id: "s1" }));
      expect(wakeSpy).toHaveBeenCalledTimes(1);

      // Two more during cooldown
      engine.handleCriticalSignal(makeSignal({ id: "s2" }));
      engine.handleCriticalSignal(makeSignal({ id: "s3" }));

      vi.advanceTimersByTime(91_000);
      // Should fire once with the queued signal (latest)
      expect(wakeSpy).toHaveBeenCalledTimes(2);
    });
  });

  // ======================================================================
  // Scheduled checks
  // ======================================================================

  describe("scheduleCheck", () => {
    it("fires wake callback after specified delay", () => {
      engine.scheduleCheck(60_000, "Check worker progress");
      expect(wakeSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(60_000);
      expect(wakeSpy).toHaveBeenCalledOnce();
      const reason: WakeReason = wakeSpy.mock.calls[0]![0];
      expect(reason.type).toBe("scheduled");
      expect(reason.reason).toBe("Check worker progress");
    });

    it("returns a check ID", () => {
      const id = engine.scheduleCheck(60_000, "test");
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });

    it("can be cancelled", () => {
      const id = engine.scheduleCheck(60_000, "test");
      engine.cancelCheck(id);
      vi.advanceTimersByTime(60_000);
      expect(wakeSpy).not.toHaveBeenCalled();
    });

    it("respects cooldown — delays if within cooldown window", () => {
      // Trigger initial wake to start cooldown
      engine.handleCriticalSignal(makeSignal());
      expect(wakeSpy).toHaveBeenCalledTimes(1);

      // Schedule a check that would fire during cooldown
      engine.scheduleCheck(10_000, "during cooldown");
      vi.advanceTimersByTime(10_000);
      // Should not fire yet — still in cooldown
      expect(wakeSpy).toHaveBeenCalledTimes(1);

      // Advance past cooldown
      vi.advanceTimersByTime(81_000);
      expect(wakeSpy).toHaveBeenCalledTimes(2);
    });
  });

  // ======================================================================
  // Event watches
  // ======================================================================

  describe("registerWatch", () => {
    it("returns a watch ID", () => {
      const id = engine.registerWatch("bead:closed");
      expect(typeof id).toBe("string");
    });

    it("fires wake on matching event via triggerWatch", () => {
      engine.registerWatch("bead:closed", undefined, undefined, "Wait for bead close");
      engine.triggerWatch("bead:closed", { id: "adj-100" });

      expect(wakeSpy).toHaveBeenCalledOnce();
      const reason: WakeReason = wakeSpy.mock.calls[0]![0];
      expect(reason.type).toBe("watch");
      expect(reason.reason).toBe("Wait for bead close");
    });

    it("does not fire on non-matching event", () => {
      engine.registerWatch("bead:closed");
      engine.triggerWatch("build:passed", { agentId: "w1" });
      expect(wakeSpy).not.toHaveBeenCalled();
    });

    it("applies filter when provided", () => {
      engine.registerWatch("bead:closed", { id: "adj-100" });
      // Non-matching filter
      engine.triggerWatch("bead:closed", { id: "adj-200" });
      expect(wakeSpy).not.toHaveBeenCalled();

      // Matching filter
      engine.triggerWatch("bead:closed", { id: "adj-100" });
      expect(wakeSpy).toHaveBeenCalledOnce();
    });

    it("times out after specified duration", () => {
      engine.registerWatch("bead:closed", undefined, 60_000, "Watch with timeout");
      vi.advanceTimersByTime(60_000);
      expect(wakeSpy).toHaveBeenCalledOnce();
      const reason: WakeReason = wakeSpy.mock.calls[0]![0];
      expect(reason.type).toBe("watch_timeout");
    });

    it("can be cancelled", () => {
      const id = engine.registerWatch("bead:closed", undefined, 60_000, "test");
      engine.cancelWatch(id);
      vi.advanceTimersByTime(60_000);
      expect(wakeSpy).not.toHaveBeenCalled();
    });

    it("is removed after it fires", () => {
      engine.registerWatch("bead:closed");
      engine.triggerWatch("bead:closed", {});
      expect(wakeSpy).toHaveBeenCalledTimes(1);

      // Second trigger should not fire again
      engine.triggerWatch("bead:closed", {});
      expect(wakeSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ======================================================================
  // getPendingSchedule
  // ======================================================================

  describe("getPendingSchedule", () => {
    it("returns pending checks and watches", () => {
      engine.scheduleCheck(60_000, "Check A");
      engine.registerWatch("bead:closed", undefined, 120_000, "Watch B");

      const pending = engine.getPendingSchedule();
      expect(pending.checks).toHaveLength(1);
      expect(pending.checks[0]!.reason).toBe("Check A");
      expect(pending.watches).toHaveLength(1);
      expect(pending.watches[0]!.reason).toBe("Watch B");
    });

    it("excludes cancelled items", () => {
      const checkId = engine.scheduleCheck(60_000, "Check A");
      const watchId = engine.registerWatch("bead:closed", undefined, 120_000, "Watch B");
      engine.cancelCheck(checkId);
      engine.cancelWatch(watchId);

      const pending = engine.getPendingSchedule();
      expect(pending.checks).toHaveLength(0);
      expect(pending.watches).toHaveLength(0);
    });
  });

  // ======================================================================
  // Multiple wake callbacks
  // ======================================================================

  describe("onWake", () => {
    it("supports multiple callbacks", () => {
      const spy2 = vi.fn();
      engine.onWake(spy2);
      engine.handleCriticalSignal(makeSignal());
      expect(wakeSpy).toHaveBeenCalledOnce();
      expect(spy2).toHaveBeenCalledOnce();
    });
  });
});

// ========================================================================
// Prompt builders (adj-054.2.2)
// ========================================================================

describe("buildSituationPrompt", () => {
  it("includes wake reason", () => {
    const prompt = buildSituationPrompt({
      wakeReason: "build:failed — agent w1",
      signals: [],
      contextSnapshot: {},
      stateSnapshot: {
        activeAgents: 3,
        workingAgents: 2,
        blockedAgents: 0,
        idleAgents: 1,
        inProgressBeads: 5,
        readyBeads: 2,
      },
      pendingSchedule: { checks: [], watches: [] },
      recentDecisions: [],
    });
    expect(prompt).toContain("build:failed");
    expect(prompt).toContain("w1");
  });

  it("includes critical signals section", () => {
    const signal = makeSignal({ event: "build:failed" });
    const prompt = buildSituationPrompt({
      wakeReason: "Critical event",
      signals: [signal],
      contextSnapshot: {},
      stateSnapshot: {
        activeAgents: 1,
        workingAgents: 1,
        blockedAgents: 0,
        idleAgents: 0,
        inProgressBeads: 1,
        readyBeads: 0,
      },
      pendingSchedule: { checks: [], watches: [] },
      recentDecisions: [],
    });
    expect(prompt).toContain("CRITICAL");
    expect(prompt).toContain("build:failed");
  });

  it("includes context signals section", () => {
    const contextSnapshot: SignalSnapshot = {
      "bead:closed": [{
        id: "s1",
        event: "bead:closed",
        data: { id: "adj-100", title: "done" },
        urgency: "context",
        timestamp: new Date(),
        count: 1,
      }],
    };
    const prompt = buildSituationPrompt({
      wakeReason: "test",
      signals: [],
      contextSnapshot,
      stateSnapshot: {
        activeAgents: 1,
        workingAgents: 1,
        blockedAgents: 0,
        idleAgents: 0,
        inProgressBeads: 1,
        readyBeads: 0,
      },
      pendingSchedule: { checks: [], watches: [] },
      recentDecisions: [],
    });
    expect(prompt).toContain("context");
    expect(prompt).toContain("bead:closed");
  });

  it("includes state snapshot", () => {
    const prompt = buildSituationPrompt({
      wakeReason: "test",
      signals: [],
      contextSnapshot: {},
      stateSnapshot: {
        activeAgents: 5,
        workingAgents: 3,
        blockedAgents: 1,
        idleAgents: 1,
        inProgressBeads: 8,
        readyBeads: 4,
      },
      pendingSchedule: { checks: [], watches: [] },
      recentDecisions: [],
    });
    expect(prompt).toContain("5");
    expect(prompt).toContain("3 working");
    expect(prompt).toContain("1 blocked");
  });

  it("includes pending schedule", () => {
    const prompt = buildSituationPrompt({
      wakeReason: "test",
      signals: [],
      contextSnapshot: {},
      stateSnapshot: {
        activeAgents: 1,
        workingAgents: 1,
        blockedAgents: 0,
        idleAgents: 0,
        inProgressBeads: 1,
        readyBeads: 0,
      },
      pendingSchedule: {
        checks: [{ id: "c1", reason: "Check worker-5", firesAt: Date.now() + 720_000, scheduledAt: Date.now() - 180_000 }],
        watches: [{ id: "w1", event: "bead:closed", reason: "Watch adj-042", registeredAt: Date.now() }],
      },
      recentDecisions: [],
    });
    expect(prompt).toContain("Check worker-5");
    expect(prompt).toContain("Watch adj-042");
  });

  it("includes recent decisions", () => {
    const prompt = buildSituationPrompt({
      wakeReason: "test",
      signals: [],
      contextSnapshot: {},
      stateSnapshot: {
        activeAgents: 1,
        workingAgents: 1,
        blockedAgents: 0,
        idleAgents: 0,
        inProgressBeads: 1,
        readyBeads: 0,
      },
      pendingSchedule: { checks: [], watches: [] },
      recentDecisions: [
        { behavior: "stimulus-engine", action: "spawn_worker", target: "worker-5", reason: "adj-042.1 unblocked", createdAt: new Date(Date.now() - 1080_000).toISOString() },
      ],
    });
    expect(prompt).toContain("spawn_worker");
    expect(prompt).toContain("worker-5");
  });

  it("includes available actions list", () => {
    const prompt = buildSituationPrompt({
      wakeReason: "test",
      signals: [],
      contextSnapshot: {},
      stateSnapshot: {
        activeAgents: 1,
        workingAgents: 1,
        blockedAgents: 0,
        idleAgents: 0,
        inProgressBeads: 1,
        readyBeads: 0,
      },
      pendingSchedule: { checks: [], watches: [] },
      recentDecisions: [],
    });
    expect(prompt).toContain("schedule_check");
    expect(prompt).toContain("watch_for");
  });

  it("produces a single-line prompt (no newlines) for tmux injection", () => {
    const prompt = buildSituationPrompt({
      wakeReason: "test",
      signals: [makeSignal()],
      contextSnapshot: { "bead:closed": [{ id: "s1", event: "bead:closed", data: {}, urgency: "context", timestamp: new Date(), count: 1 }] },
      stateSnapshot: {
        activeAgents: 1,
        workingAgents: 1,
        blockedAgents: 0,
        idleAgents: 0,
        inProgressBeads: 1,
        readyBeads: 0,
      },
      pendingSchedule: { checks: [], watches: [] },
      recentDecisions: [],
    });
    expect(prompt).not.toContain("\n");
  });
});

describe("buildBootstrapPrompt", () => {
  it("contains BOOTSTRAP header", () => {
    const prompt = buildBootstrapPrompt();
    expect(prompt).toContain("BOOTSTRAP");
  });

  it("instructs to call list_agents and list_beads", () => {
    const prompt = buildBootstrapPrompt();
    expect(prompt).toContain("list_agents");
    expect(prompt).toContain("list_beads");
  });

  it("mentions schedule_check for follow-ups", () => {
    const prompt = buildBootstrapPrompt();
    expect(prompt).toContain("schedule_check");
  });

  it("produces a single-line prompt (no newlines)", () => {
    const prompt = buildBootstrapPrompt();
    expect(prompt).not.toContain("\n");
  });
});
