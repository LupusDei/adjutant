import { describe, it, expect, vi, beforeEach } from "vitest";

import { createQualityGateBehavior } from "../../../../src/services/adjutant/behaviors/quality-gate.js";
import type { BehaviorEvent } from "../../../../src/services/adjutant/behavior-registry.js";
import type { BeadClosedEvent } from "../../../../src/services/event-bus.js";
import type { DecisionEntry } from "../../../../src/services/adjutant/state-store.js";

function createMockState() {
  return {
    upsertAgentProfile: vi.fn(),
    logDecision: vi.fn(),
    getAgentProfile: vi.fn(),
    getAllAgentProfiles: vi.fn().mockReturnValue([]),
    getRecentDecisions: vi.fn().mockReturnValue([] as DecisionEntry[]),
    getMeta: vi.fn().mockReturnValue(null),
    setMeta: vi.fn(),
  };
}

function createMockComm() {
  return {
    queueRoutine: vi.fn(),
    sendImportant: vi.fn(),
    escalate: vi.fn(),
    messageAgent: vi.fn(),
    flushRoutineQueue: vi.fn(),
    getRoutineQueueLength: vi.fn(),
  };
}

function beadClosedEvent(overrides: Partial<BeadClosedEvent> = {}): BehaviorEvent {
  return {
    name: "bead:closed",
    data: {
      id: "adj-042.1.3",
      title: "Implement login form",
      closedAt: "2026-03-08T21:00:00Z",
      type: "task",
      assignee: "engineer-1",
      ...overrides,
    } satisfies BeadClosedEvent,
    seq: 1,
  };
}

describe("qualityGateBehavior", () => {
  let behavior: ReturnType<typeof createQualityGateBehavior>;

  beforeEach(() => {
    behavior = createQualityGateBehavior();
  });

  it("has the correct name", () => {
    expect(behavior.name).toBe("quality-gate");
  });

  it("triggers on bead:closed", () => {
    expect(behavior.triggers).toEqual(["bead:closed"]);
  });

  describe("shouldAct", () => {
    it("returns true for task bead closures", () => {
      const state = createMockState();
      expect(behavior.shouldAct(beadClosedEvent({ type: "task" }), state)).toBe(true);
    });

    it("returns true for bug bead closures", () => {
      const state = createMockState();
      expect(behavior.shouldAct(beadClosedEvent({ type: "bug" }), state)).toBe(true);
    });

    it("returns false for epic bead closures", () => {
      const state = createMockState();
      expect(behavior.shouldAct(beadClosedEvent({ type: "epic" }), state)).toBe(false);
    });

    it("returns false for beads closed with 'by-design' reason", () => {
      const state = createMockState();
      expect(behavior.shouldAct(beadClosedEvent({ reason: "by-design" }), state)).toBe(false);
    });

    it("returns false for beads closed with 'deferred' reason", () => {
      const state = createMockState();
      expect(behavior.shouldAct(beadClosedEvent({ reason: "deferred" }), state)).toBe(false);
    });

    it("returns true when type is missing (defaults to checking)", () => {
      const state = createMockState();
      expect(behavior.shouldAct(beadClosedEvent({ type: undefined }), state)).toBe(true);
    });

    it("returns false for beads with no assignee", () => {
      const state = createMockState();
      expect(behavior.shouldAct(beadClosedEvent({ assignee: undefined }), state)).toBe(false);
    });
  });

  describe("act — build verification", () => {
    it("logs a quality-gate pass when recent build passed", async () => {
      const state = createMockState();
      const comm = createMockComm();

      // Recent build_passed decision for the agent
      state.getRecentDecisions.mockReturnValue([
        {
          id: 1,
          behavior: "build-monitor",
          action: "build_passed",
          target: "engineer-1",
          reason: null,
          createdAt: "2026-03-08T20:59:00Z",
        },
      ]);

      await behavior.act(beadClosedEvent(), state, comm);

      expect(state.logDecision).toHaveBeenCalledWith({
        behavior: "quality-gate",
        action: "gate_passed",
        target: "adj-042.1.3",
        reason: "build verification passed",
      });
    });

    it("queues a routine message on pass", async () => {
      const state = createMockState();
      const comm = createMockComm();

      state.getRecentDecisions.mockReturnValue([
        {
          id: 1,
          behavior: "build-monitor",
          action: "build_passed",
          target: "engineer-1",
          reason: null,
          createdAt: "2026-03-08T20:59:00Z",
        },
      ]);

      await behavior.act(beadClosedEvent(), state, comm);

      expect(comm.queueRoutine).toHaveBeenCalledOnce();
      expect(comm.queueRoutine).toHaveBeenCalledWith(
        expect.stringContaining("adj-042.1.3"),
      );
    });

    it("sends important message when last build for agent failed", async () => {
      const state = createMockState();
      const comm = createMockComm();

      // Most recent decision for this agent is build_failed
      state.getRecentDecisions.mockReturnValue([
        {
          id: 2,
          behavior: "build-monitor",
          action: "build_failed",
          target: "engineer-1",
          reason: "exit code 1",
          createdAt: "2026-03-08T20:59:00Z",
        },
      ]);

      await behavior.act(beadClosedEvent(), state, comm);

      expect(state.logDecision).toHaveBeenCalledWith({
        behavior: "quality-gate",
        action: "gate_failed",
        target: "adj-042.1.3",
        reason: expect.stringContaining("build"),
      });

      expect(comm.sendImportant).toHaveBeenCalledOnce();
      expect(comm.sendImportant).toHaveBeenCalledWith(
        expect.stringContaining("adj-042.1.3"),
      );
    });

    it("messages the assignee agent when gate fails", async () => {
      const state = createMockState();
      const comm = createMockComm();

      state.getRecentDecisions.mockReturnValue([
        {
          id: 2,
          behavior: "build-monitor",
          action: "build_failed",
          target: "engineer-1",
          reason: "exit code 1",
          createdAt: "2026-03-08T20:59:00Z",
        },
      ]);

      await behavior.act(beadClosedEvent(), state, comm);

      expect(comm.messageAgent).toHaveBeenCalledOnce();
      expect(comm.messageAgent).toHaveBeenCalledWith(
        "engineer-1",
        expect.stringContaining("quality gate"),
      );
    });

    it("passes when no build decisions exist (no data = no block)", async () => {
      const state = createMockState();
      const comm = createMockComm();

      state.getRecentDecisions.mockReturnValue([]);

      await behavior.act(beadClosedEvent(), state, comm);

      expect(state.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({ action: "gate_passed" }),
      );
      expect(comm.sendImportant).not.toHaveBeenCalled();
    });

    it("only checks build decisions for the closing bead's assignee", async () => {
      const state = createMockState();
      const comm = createMockComm();

      // Build failed for a DIFFERENT agent
      state.getRecentDecisions.mockReturnValue([
        {
          id: 3,
          behavior: "build-monitor",
          action: "build_failed",
          target: "engineer-2",
          reason: "exit code 1",
          createdAt: "2026-03-08T20:59:00Z",
        },
      ]);

      await behavior.act(beadClosedEvent({ assignee: "engineer-1" }), state, comm);

      // Should pass because the failure was for a different agent
      expect(state.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({ action: "gate_passed" }),
      );
    });
  });

  describe("act — unrecognized event", () => {
    it("does not crash on unrecognized event name", async () => {
      const state = createMockState();
      const comm = createMockComm();
      const event: BehaviorEvent = { name: "mail:received", data: {}, seq: 5 };

      await behavior.act(event, state, comm);

      expect(state.logDecision).not.toHaveBeenCalled();
    });
  });
});
