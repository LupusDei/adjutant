import { describe, it, expect, vi, beforeEach } from "vitest";

import { createBuildMonitorBehavior } from "../../../../src/services/adjutant/behaviors/build-monitor.js";
import type { BehaviorEvent } from "../../../../src/services/adjutant/behavior-registry.js";
import type { BuildFailedEvent, BuildPassedEvent } from "../../../../src/services/event-bus.js";

function createMockState() {
  return {
    upsertAgentProfile: vi.fn(),
    logDecision: vi.fn(),
    getAgentProfile: vi.fn(),
    getAllAgentProfiles: vi.fn().mockReturnValue([]),
    getRecentDecisions: vi.fn().mockReturnValue([]),
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

function buildFailedEvent(overrides: Partial<BuildFailedEvent> = {}): BehaviorEvent {
  return {
    name: "build:failed",
    data: {
      agentId: "engineer-1",
      exitCode: 1,
      errorOutput: "error TS2345: Argument of type 'string' is not assignable",
      streamId: "stream-42",
      ...overrides,
    },
    seq: 1,
  };
}

function buildPassedEvent(overrides: Partial<BuildPassedEvent> = {}): BehaviorEvent {
  return {
    name: "build:passed",
    data: {
      agentId: "engineer-1",
      streamId: "stream-43",
      ...overrides,
    },
    seq: 2,
  };
}

describe("buildMonitorBehavior", () => {
  let behavior: ReturnType<typeof createBuildMonitorBehavior>;

  beforeEach(() => {
    behavior = createBuildMonitorBehavior();
  });

  it("has the correct name", () => {
    expect(behavior.name).toBe("build-monitor");
  });

  it("triggers on build:failed and build:passed", () => {
    expect(behavior.triggers).toEqual(["build:failed", "build:passed"]);
  });

  describe("shouldAct", () => {
    it("returns true for build:failed events", () => {
      const state = createMockState();
      expect(behavior.shouldAct(buildFailedEvent(), state)).toBe(true);
    });

    it("returns true for build:passed events", () => {
      const state = createMockState();
      expect(behavior.shouldAct(buildPassedEvent(), state)).toBe(true);
    });
  });

  describe("act — build:failed", () => {
    it("logs a decision with agent and exit code", async () => {
      const state = createMockState();
      const comm = createMockComm();

      await behavior.act(buildFailedEvent(), state, comm);

      expect(state.logDecision).toHaveBeenCalledOnce();
      expect(state.logDecision).toHaveBeenCalledWith({
        behavior: "build-monitor",
        action: "build_failed",
        target: "engineer-1",
        reason: "exit code 1",
      });
    });

    it("sends an important message to the user", async () => {
      const state = createMockState();
      const comm = createMockComm();

      await behavior.act(buildFailedEvent(), state, comm);

      expect(comm.sendImportant).toHaveBeenCalledOnce();
      expect(comm.sendImportant).toHaveBeenCalledWith(
        expect.stringContaining("engineer-1"),
      );
      expect(comm.sendImportant).toHaveBeenCalledWith(
        expect.stringContaining("build failed"),
      );
    });

    it("includes error output in the message (truncated)", async () => {
      const state = createMockState();
      const comm = createMockComm();
      const longError = "x".repeat(600);

      await behavior.act(buildFailedEvent({ errorOutput: longError }), state, comm);

      const msg = comm.sendImportant.mock.calls[0][0] as string;
      expect(msg.length).toBeLessThan(700);
    });

    it("messages the failing agent", async () => {
      const state = createMockState();
      const comm = createMockComm();

      await behavior.act(buildFailedEvent(), state, comm);

      expect(comm.messageAgent).toHaveBeenCalledOnce();
      expect(comm.messageAgent).toHaveBeenCalledWith(
        "engineer-1",
        expect.stringContaining("build failed"),
      );
    });

    it("rate-limits to 1 notification per agent per 10 minutes", async () => {
      const state = createMockState();
      const comm = createMockComm();

      // First call: should notify
      await behavior.act(buildFailedEvent(), state, comm);
      expect(comm.sendImportant).toHaveBeenCalledOnce();

      // Second call immediately: should be rate-limited
      await behavior.act(buildFailedEvent({ streamId: "stream-99" }), state, comm);
      expect(comm.sendImportant).toHaveBeenCalledOnce(); // still 1

      // Should still log the decision even when rate-limited
      expect(state.logDecision).toHaveBeenCalledTimes(2);
    });

    it("rate-limits per agent — different agents are not rate-limited", async () => {
      const state = createMockState();
      const comm = createMockComm();

      await behavior.act(buildFailedEvent({ agentId: "engineer-1" }), state, comm);
      await behavior.act(buildFailedEvent({ agentId: "engineer-2" }), state, comm);

      expect(comm.sendImportant).toHaveBeenCalledTimes(2);
    });

    it("skips notification for bug-fix bead streams", async () => {
      const state = createMockState();
      const comm = createMockComm();

      // Agent is currently working on a bug-fix bead
      state.getAgentProfile.mockReturnValue({
        agentId: "engineer-1",
        currentTask: "Fixing adj-qv4q: build-monitor bug",
      });

      await behavior.act(buildFailedEvent(), state, comm);

      // Should still log but not notify user (to avoid loops)
      expect(state.logDecision).toHaveBeenCalledOnce();
      expect(comm.sendImportant).not.toHaveBeenCalled();
      expect(comm.messageAgent).toHaveBeenCalledOnce(); // still message the agent
    });
  });

  describe("act — build:passed", () => {
    it("logs a decision", async () => {
      const state = createMockState();
      const comm = createMockComm();

      await behavior.act(buildPassedEvent(), state, comm);

      expect(state.logDecision).toHaveBeenCalledOnce();
      expect(state.logDecision).toHaveBeenCalledWith({
        behavior: "build-monitor",
        action: "build_passed",
        target: "engineer-1",
        reason: null,
      });
    });

    it("queues a routine message (not important)", async () => {
      const state = createMockState();
      const comm = createMockComm();

      await behavior.act(buildPassedEvent(), state, comm);

      expect(comm.queueRoutine).toHaveBeenCalledOnce();
      expect(comm.sendImportant).not.toHaveBeenCalled();
    });

    it("clears the rate-limit for that agent after a successful build", async () => {
      const state = createMockState();
      const comm = createMockComm();

      // First failure: should notify
      await behavior.act(buildFailedEvent(), state, comm);
      expect(comm.sendImportant).toHaveBeenCalledOnce();

      // Pass clears rate limit
      await behavior.act(buildPassedEvent(), state, comm);

      // Second failure after pass: should notify again
      await behavior.act(buildFailedEvent({ streamId: "stream-100" }), state, comm);
      expect(comm.sendImportant).toHaveBeenCalledTimes(2);
    });
  });

  describe("act — unrecognized event", () => {
    it("does not crash on unrecognized event name", async () => {
      const state = createMockState();
      const comm = createMockComm();
      const event: BehaviorEvent = { name: "bead:created", data: {}, seq: 5 };

      await behavior.act(event, state, comm);

      expect(state.logDecision).not.toHaveBeenCalled();
      expect(comm.sendImportant).not.toHaveBeenCalled();
    });
  });
});
