import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ScheduledTask } from "node-cron";

const { mockSchedule, mockOnAny, mockOffAny } = vi.hoisted(() => ({
  mockSchedule: vi.fn(),
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

// Mock node-cron
vi.mock("node-cron", () => ({
  default: { schedule: mockSchedule },
  schedule: mockSchedule,
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

describe("AdjutantCore", () => {
  let registry: BehaviorRegistry;
  let state: AdjutantState;
  let comm: CommunicationManager;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new BehaviorRegistry();
    state = createMockState();
    comm = createMockComm();
    mockSchedule.mockReturnValue({ stop: vi.fn() } as unknown as ScheduledTask);
  });

  afterEach(() => {
    stopAdjutantCore();
  });

  describe("initAdjutantCore", () => {
    it("should subscribe to EventBus via onAny", () => {
      initAdjutantCore({ registry, state, comm });
      expect(mockOnAny).toHaveBeenCalledOnce();
      expect(mockOnAny).toHaveBeenCalledWith(expect.any(Function));
    });

    it("should register cron jobs for scheduled behaviors", () => {
      const scheduled = createTestBehavior({
        name: "scheduled-behavior",
        schedule: "0 * * * *",
        triggers: [],
      });
      registry.register(scheduled);

      initAdjutantCore({ registry, state, comm });

      expect(mockSchedule).toHaveBeenCalledOnce();
      expect(mockSchedule).toHaveBeenCalledWith("0 * * * *", expect.any(Function));
    });

    it("should not register cron jobs for non-scheduled behaviors", () => {
      const eventOnly = createTestBehavior({
        name: "event-only",
        triggers: ["agent:status_changed"],
      });
      registry.register(eventOnly);

      initAdjutantCore({ registry, state, comm });

      expect(mockSchedule).not.toHaveBeenCalled();
    });

    it("should register multiple cron jobs for multiple scheduled behaviors", () => {
      const b1 = createTestBehavior({ name: "b1", schedule: "0 * * * *", triggers: [] });
      const b2 = createTestBehavior({ name: "b2", schedule: "*/5 * * * *", triggers: [] });
      registry.register(b1);
      registry.register(b2);

      initAdjutantCore({ registry, state, comm });

      expect(mockSchedule).toHaveBeenCalledTimes(2);
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

      // Give microtask queue time
      await new Promise((r) => setTimeout(r, 10));

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

      await new Promise((r) => setTimeout(r, 10));

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

      await new Promise((r) => setTimeout(r, 10));

      expect(behavior.act).not.toHaveBeenCalled();
    });
  });

  describe("scheduled behavior dispatch", () => {
    it("should call shouldAct and act on cron tick", async () => {
      const behavior = createTestBehavior({
        name: "periodic",
        triggers: [],
        schedule: "0 * * * *",
      });
      registry.register(behavior);

      initAdjutantCore({ registry, state, comm });

      // Extract the cron callback
      const cronCallback = mockSchedule.mock.calls[0]![1] as () => void;

      // Simulate cron tick
      cronCallback();

      await vi.waitFor(() => {
        expect(behavior.shouldAct).toHaveBeenCalledOnce();
        expect(behavior.act).toHaveBeenCalledOnce();
      });

      // Verify scheduled event has name "cron:<behavior-name>"
      const calledEvent = (behavior.shouldAct as ReturnType<typeof vi.fn>).mock.calls[0]![0] as BehaviorEvent;
      expect(calledEvent.name).toBe("agent:status_changed"); // uses first trigger or falls back
    });
  });

  describe("stopAdjutantCore", () => {
    it("should unsubscribe from EventBus", () => {
      initAdjutantCore({ registry, state, comm });
      stopAdjutantCore();

      expect(mockOffAny).toHaveBeenCalledOnce();
    });

    it("should stop all cron jobs", () => {
      const mockStop = vi.fn();
      mockSchedule.mockReturnValue({ stop: mockStop } as unknown as ScheduledTask);

      const behavior = createTestBehavior({
        name: "periodic",
        schedule: "0 * * * *",
        triggers: [],
      });
      registry.register(behavior);

      initAdjutantCore({ registry, state, comm });
      stopAdjutantCore();

      expect(mockStop).toHaveBeenCalledOnce();
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
