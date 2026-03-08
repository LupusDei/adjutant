import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockOnAny, mockOffAny } = vi.hoisted(() => ({
  mockOnAny: vi.fn(),
  mockOffAny: vi.fn(),
}));

// Suppress logging
vi.mock("../../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock EventBus
vi.mock("../../../src/services/event-bus.js", () => ({
  getEventBus: () => ({
    onAny: mockOnAny,
    offAny: mockOffAny,
  }),
}));

import {
  initAdjutantCore,
  stopAdjutantCore,
  cronToIntervalMs,
} from "../../../src/services/adjutant/adjutant-core.js";
import type { AdjutantBehavior, BehaviorEvent } from "../../../src/services/adjutant/behavior-registry.js";
import { BehaviorRegistry } from "../../../src/services/adjutant/behavior-registry.js";
import type { AdjutantState } from "../../../src/services/adjutant/state-store.js";
import type { CommunicationManager } from "../../../src/services/adjutant/communication.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockState(): AdjutantState {
  return {
    getAgentProfile: vi.fn(() => null),
    upsertAgentProfile: vi.fn(),
    getAllAgentProfiles: vi.fn(() => []),
    logDecision: vi.fn(),
    getRecentDecisions: vi.fn(() => []),
    getMeta: vi.fn(() => null),
    setMeta: vi.fn(),
    pruneOldDecisions: vi.fn(() => 0),
  };
}

function createMockComm(): CommunicationManager {
  return {
    queueRoutine: vi.fn(),
    sendImportant: vi.fn(async () => {}),
    escalate: vi.fn(async () => {}),
    messageAgent: vi.fn(async () => {}),
    flushRoutineQueue: vi.fn(() => []),
    getRoutineQueueLength: vi.fn(() => 0),
  };
}

function createTestBehavior(overrides: Partial<AdjutantBehavior> = {}): AdjutantBehavior {
  return {
    name: "test-behavior",
    triggers: ["agent:status_changed"],
    shouldAct: vi.fn(() => true),
    act: vi.fn(async () => {}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cronToIntervalMs", () => {
  it("should parse */5 * * * * to 5 minutes", () => {
    expect(cronToIntervalMs("*/5 * * * *")).toBe(5 * 60 * 1000);
  });

  it("should parse */15 * * * * to 15 minutes", () => {
    expect(cronToIntervalMs("*/15 * * * *")).toBe(15 * 60 * 1000);
  });

  it("should parse 0 * * * * to 60 minutes", () => {
    expect(cronToIntervalMs("0 * * * *")).toBe(60 * 60 * 1000);
  });

  it("should parse */1 * * * * to 1 minute", () => {
    expect(cronToIntervalMs("*/1 * * * *")).toBe(60 * 1000);
  });

  it("should throw on non-minute-level cron patterns", () => {
    expect(() => cronToIntervalMs("0 0 * * *")).toThrow("only minute-level");
  });

  it("should throw on unsupported minute field", () => {
    expect(() => cronToIntervalMs("1,30 * * * *")).toThrow("Unsupported cron minute field");
  });

  it("should throw on wrong number of fields", () => {
    expect(() => cronToIntervalMs("* * *")).toThrow("expected 5 fields");
  });
});

describe("AdjutantCore", () => {
  let registry: BehaviorRegistry;
  let state: AdjutantState;
  let comm: CommunicationManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    registry = new BehaviorRegistry();
    state = createMockState();
    comm = createMockComm();
  });

  afterEach(() => {
    stopAdjutantCore();
    vi.useRealTimers();
  });

  describe("initAdjutantCore", () => {
    it("should subscribe to EventBus via onAny", () => {
      initAdjutantCore({ registry, state, comm });
      expect(mockOnAny).toHaveBeenCalledOnce();
      expect(mockOnAny).toHaveBeenCalledWith(expect.any(Function));
    });

    it("should register interval timers for scheduled behaviors", () => {
      const scheduled = createTestBehavior({
        name: "scheduled-behavior",
        schedule: "*/5 * * * *",
        triggers: [],
      });
      registry.register(scheduled);

      initAdjutantCore({ registry, state, comm });

      // Advance 5 minutes — fires once from interval + once from 60s startup fire
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(scheduled.shouldAct).toHaveBeenCalledTimes(2);
    });

    it("should not register timers for non-scheduled behaviors", () => {
      const eventOnly = createTestBehavior({
        name: "event-only",
        triggers: ["agent:status_changed"],
      });
      registry.register(eventOnly);

      initAdjutantCore({ registry, state, comm });

      // Advance time — should not fire
      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(eventOnly.shouldAct).not.toHaveBeenCalled();
    });

    it("should register timers for multiple scheduled behaviors", () => {
      const b1 = createTestBehavior({ name: "b1", schedule: "*/5 * * * *", triggers: [] });
      const b2 = createTestBehavior({ name: "b2", schedule: "*/15 * * * *", triggers: [] });
      registry.register(b1);
      registry.register(b2);

      initAdjutantCore({ registry, state, comm });

      // After 15 minutes: b1 fires 3 interval + 1 startup = 4, b2 fires 1 interval + 1 startup = 2
      vi.advanceTimersByTime(15 * 60 * 1000);
      expect(b1.shouldAct).toHaveBeenCalledTimes(4);
      expect(b2.shouldAct).toHaveBeenCalledTimes(2);
    });

    it("should be idempotent — second call is a no-op", () => {
      initAdjutantCore({ registry, state, comm });
      initAdjutantCore({ registry, state, comm });

      expect(mockOnAny).toHaveBeenCalledOnce();
    });
  });

  describe("event dispatch", () => {
    it("should dispatch matching events to behavior shouldAct + act", async () => {
      const behavior = createTestBehavior({
        name: "lifecycle",
        triggers: ["agent:status_changed"],
      });
      registry.register(behavior);

      initAdjutantCore({ registry, state, comm });

      // Extract the handler registered with onAny
      const handler = mockOnAny.mock.calls[0]![0] as (
        event: string,
        data: unknown,
        seq: number,
      ) => void;

      // Simulate an event
      handler("agent:status_changed", { agent: "test", status: "working" }, 1);

      // shouldAct and act should be called (act is async, give microtask time)
      await vi.waitFor(() => {
        expect(behavior.shouldAct).toHaveBeenCalledOnce();
        expect(behavior.act).toHaveBeenCalledOnce();
      });

      // Verify correct arguments
      const expectedEvent: BehaviorEvent = {
        name: "agent:status_changed",
        data: { agent: "test", status: "working" },
        seq: 1,
      };
      expect(behavior.shouldAct).toHaveBeenCalledWith(expectedEvent, state);
      expect(behavior.act).toHaveBeenCalledWith(expectedEvent, state, comm);
    });

    it("should not call act when shouldAct returns false", async () => {
      const behavior = createTestBehavior({
        name: "guarded",
        triggers: ["agent:status_changed"],
        shouldAct: vi.fn(() => false),
      });
      registry.register(behavior);

      initAdjutantCore({ registry, state, comm });

      const handler = mockOnAny.mock.calls[0]![0] as (
        event: string,
        data: unknown,
        seq: number,
      ) => void;

      handler("agent:status_changed", {}, 1);

      await vi.advanceTimersByTimeAsync(10);

      expect(behavior.shouldAct).toHaveBeenCalledOnce();
      expect(behavior.act).not.toHaveBeenCalled();
    });

    it("should not dispatch to behaviors that don't match the event", async () => {
      const behavior = createTestBehavior({
        name: "bead-only",
        triggers: ["bead:created"],
      });
      registry.register(behavior);

      initAdjutantCore({ registry, state, comm });

      const handler = mockOnAny.mock.calls[0]![0] as (
        event: string,
        data: unknown,
        seq: number,
      ) => void;

      handler("agent:status_changed", {}, 1);

      await vi.advanceTimersByTimeAsync(10);

      expect(behavior.shouldAct).not.toHaveBeenCalled();
      expect(behavior.act).not.toHaveBeenCalled();
    });

    it("should dispatch to multiple matching behaviors", async () => {
      const b1 = createTestBehavior({ name: "b1", triggers: ["agent:status_changed"] });
      const b2 = createTestBehavior({ name: "b2", triggers: ["agent:status_changed"] });
      registry.register(b1);
      registry.register(b2);

      initAdjutantCore({ registry, state, comm });

      const handler = mockOnAny.mock.calls[0]![0] as (
        event: string,
        data: unknown,
        seq: number,
      ) => void;

      handler("agent:status_changed", {}, 1);

      await vi.waitFor(() => {
        expect(b1.act).toHaveBeenCalledOnce();
        expect(b2.act).toHaveBeenCalledOnce();
      });
    });

    it("should handle errors in behavior.act gracefully", async () => {
      const behavior = createTestBehavior({
        name: "failing",
        triggers: ["agent:status_changed"],
        act: vi.fn(async () => {
          throw new Error("behavior failed");
        }),
      });
      registry.register(behavior);

      initAdjutantCore({ registry, state, comm });

      const handler = mockOnAny.mock.calls[0]![0] as (
        event: string,
        data: unknown,
        seq: number,
      ) => void;

      // Should not throw
      expect(() => handler("agent:status_changed", {}, 1)).not.toThrow();

      await vi.waitFor(() => {
        expect(behavior.act).toHaveBeenCalledOnce();
      });
    });

    it("should handle errors in behavior.shouldAct gracefully", async () => {
      const behavior = createTestBehavior({
        name: "shouldact-fails",
        triggers: ["agent:status_changed"],
        shouldAct: vi.fn(() => {
          throw new Error("shouldAct failed");
        }),
      });
      registry.register(behavior);

      initAdjutantCore({ registry, state, comm });

      const handler = mockOnAny.mock.calls[0]![0] as (
        event: string,
        data: unknown,
        seq: number,
      ) => void;

      // Should not throw
      expect(() => handler("agent:status_changed", {}, 1)).not.toThrow();

      await vi.advanceTimersByTimeAsync(10);

      expect(behavior.act).not.toHaveBeenCalled();
    });
  });

  describe("scheduled behavior dispatch", () => {
    it("should call shouldAct and act on interval tick", async () => {
      const behavior = createTestBehavior({
        name: "periodic",
        triggers: [],
        schedule: "0 * * * *",
      });
      registry.register(behavior);

      initAdjutantCore({ registry, state, comm });

      // Advance by 1 hour — 1 interval tick + 1 startup fire at 60s = 2
      vi.advanceTimersByTime(60 * 60 * 1000);

      await vi.waitFor(() => {
        expect(behavior.shouldAct).toHaveBeenCalledTimes(2);
        expect(behavior.act).toHaveBeenCalledTimes(2);
      });
    });

    it("should fire startup event after 60-second delay", () => {
      const behavior = createTestBehavior({
        name: "periodic",
        triggers: [],
        schedule: "*/5 * * * *",
      });
      registry.register(behavior);

      initAdjutantCore({ registry, state, comm });

      // At 59 seconds — startup hasn't fired yet, no interval yet either
      vi.advanceTimersByTime(59_999);
      expect(behavior.shouldAct).not.toHaveBeenCalled();

      // At 60 seconds — startup fire triggers
      vi.advanceTimersByTime(1);
      expect(behavior.shouldAct).toHaveBeenCalledOnce();

      // Verify startup event data
      const event = (behavior.shouldAct as ReturnType<typeof vi.fn>).mock.calls[0]![0] as BehaviorEvent;
      expect(event.data).toEqual(
        expect.objectContaining({ cronTick: true, startup: true }),
      );
    });

    it("should not fire missed executions after sleep", () => {
      const behavior = createTestBehavior({
        name: "periodic",
        triggers: [],
        schedule: "*/5 * * * *",
      });
      registry.register(behavior);

      initAdjutantCore({ registry, state, comm });

      // Advance 1 hour — setInterval fires at each interval, no catch-up spam
      vi.advanceTimersByTime(60 * 60 * 1000);

      // setInterval fires 12 times (60/5) + 1 startup fire at 60s = 13
      expect(behavior.shouldAct).toHaveBeenCalledTimes(13);
    });
  });

  describe("stopAdjutantCore", () => {
    it("should unsubscribe from EventBus", () => {
      initAdjutantCore({ registry, state, comm });
      stopAdjutantCore();

      expect(mockOffAny).toHaveBeenCalledOnce();
    });

    it("should stop all interval timers", () => {
      const behavior = createTestBehavior({
        name: "periodic",
        schedule: "*/5 * * * *",
        triggers: [],
      });
      registry.register(behavior);

      initAdjutantCore({ registry, state, comm });
      stopAdjutantCore();

      // Advance time — timer should be cleared, no more calls
      vi.advanceTimersByTime(30 * 60 * 1000);
      expect(behavior.shouldAct).not.toHaveBeenCalled();
    });

    it("should be safe to call without init", () => {
      expect(() => stopAdjutantCore()).not.toThrow();
    });

    it("should allow re-initialization after stop", () => {
      initAdjutantCore({ registry, state, comm });
      stopAdjutantCore();
      initAdjutantCore({ registry, state, comm });

      expect(mockOnAny).toHaveBeenCalledTimes(2);
    });
  });
});
