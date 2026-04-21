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
  type WakeReason,
  type SituationPromptInput,
  type PendingRecurringSchedule,
} from "../../../src/services/adjutant/stimulus-engine.js";
import type { CronSchedule } from "../../../src/services/adjutant/cron-schedule-store.js";
import type { CronScheduleStore } from "../../../src/services/adjutant/cron-schedule-store.js";

function makeSchedule(overrides: Partial<CronSchedule> = {}): CronSchedule {
  return {
    id: "sched-1",
    cronExpr: "*/15 * * * *",
    reason: "Health check",
    createdBy: "adjutant",
    createdAt: "2026-03-24T12:00:00.000Z",
    lastFiredAt: null,
    nextFireAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    enabled: true,
    maxFires: null,
    fireCount: 0,
    ...overrides,
  };
}

function makeMockStore(schedules: CronSchedule[] = []): CronScheduleStore {
  return {
    create: vi.fn(),
    getById: vi.fn(),
    listAll: vi.fn().mockReturnValue(schedules),
    listEnabled: vi.fn().mockReturnValue(schedules.filter((s) => s.enabled)),
    update: vi.fn().mockReturnValue(true),
    delete: vi.fn().mockReturnValue(true),
    incrementFireCount: vi.fn().mockReturnValue(true),
    disable: vi.fn().mockReturnValue(true),
  } as unknown as CronScheduleStore;
}

describe("StimulusEngine — recurring schedules", () => {
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
  // loadRecurringSchedules
  // ======================================================================

  describe("loadRecurringSchedules", () => {
    it("should register timers for all enabled schedules", () => {
      const schedule = makeSchedule({
        nextFireAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });
      const store = makeMockStore([schedule]);

      engine.loadRecurringSchedules(store);

      // Advance to when it should fire
      vi.advanceTimersByTime(5 * 60 * 1000);

      expect(wakeSpy).toHaveBeenCalledOnce();
      const reason: WakeReason = wakeSpy.mock.calls[0]![0];
      expect(reason.type).toBe("recurring");
      expect(reason.reason).toBe("Health check");
    });

    it("should fire immediately for overdue schedules (nextFireAt in the past)", () => {
      const schedule = makeSchedule({
        nextFireAt: new Date(Date.now() - 60_000).toISOString(), // 1 minute ago
      });
      const store = makeMockStore([schedule]);

      engine.loadRecurringSchedules(store);

      // Should fire on next tick (setTimeout(fn, 0))
      vi.advanceTimersByTime(1);

      expect(wakeSpy).toHaveBeenCalledOnce();
      const reason: WakeReason = wakeSpy.mock.calls[0]![0];
      expect(reason.type).toBe("recurring");
    });

    it("should call incrementFireCount on the store when a schedule fires", () => {
      const schedule = makeSchedule({
        nextFireAt: new Date(Date.now() + 1000).toISOString(),
      });
      const store = makeMockStore([schedule]);

      engine.loadRecurringSchedules(store);
      vi.advanceTimersByTime(1000);

      expect(store.incrementFireCount).toHaveBeenCalledWith(
        schedule.id,
        expect.any(String),
        expect.any(String),
      );
    });

    it("should disable schedule when maxFires is reached", () => {
      const schedule = makeSchedule({
        nextFireAt: new Date(Date.now() + 1000).toISOString(),
        maxFires: 1,
        fireCount: 0,
      });
      const store = makeMockStore([schedule]);

      engine.loadRecurringSchedules(store);
      vi.advanceTimersByTime(1000);

      expect(wakeSpy).toHaveBeenCalledOnce();
      expect(store.disable).toHaveBeenCalledWith(schedule.id);
      // incrementFireCount should still be called
      expect(store.incrementFireCount).toHaveBeenCalled();
    });

    // adj-163.2.1: targetAgent propagation from schedule to WakeReason
    it("should pass targetAgent from schedule to WakeReason when present", () => {
      const schedule = makeSchedule({
        nextFireAt: new Date(Date.now() + 1000).toISOString(),
        // These fields come from Phase 1 (adj-163.1) — cast needed until Phase 1 lands
        ...(({ targetAgent: "nova", targetTmuxSession: "tmux-nova-123" }) as Record<string, string>),
      });
      const store = makeMockStore([schedule]);

      engine.loadRecurringSchedules(store);
      vi.advanceTimersByTime(1000);

      expect(wakeSpy).toHaveBeenCalledOnce();
      const reason: WakeReason = wakeSpy.mock.calls[0]![0];
      expect(reason.type).toBe("recurring");
      expect(reason.targetAgent).toBe("nova");
      expect(reason.targetTmuxSession).toBe("tmux-nova-123");
      expect(reason.scheduleId).toBe("sched-1");
    });

    it("should leave targetAgent undefined when schedule has no targetAgent", () => {
      const schedule = makeSchedule({
        nextFireAt: new Date(Date.now() + 1000).toISOString(),
      });
      const store = makeMockStore([schedule]);

      engine.loadRecurringSchedules(store);
      vi.advanceTimersByTime(1000);

      expect(wakeSpy).toHaveBeenCalledOnce();
      const reason: WakeReason = wakeSpy.mock.calls[0]![0];
      expect(reason.targetAgent).toBeUndefined();
      expect(reason.targetTmuxSession).toBeUndefined();
      // scheduleId should always be present for recurring schedules
      expect(reason.scheduleId).toBe("sched-1");
    });

    it("should re-register timer after firing when maxFires not reached", () => {
      const schedule = makeSchedule({
        nextFireAt: new Date(Date.now() + 1000).toISOString(),
        maxFires: 3,
        fireCount: 0,
      });
      const store = makeMockStore([schedule]);

      engine.loadRecurringSchedules(store);

      // First fire
      vi.advanceTimersByTime(1000);
      expect(wakeSpy).toHaveBeenCalledTimes(1);

      // Advance past cooldown + next interval (~15 minutes)
      vi.advanceTimersByTime(91_000); // cooldown
      vi.advanceTimersByTime(15 * 60 * 1000); // next interval

      // Should have fired again (second fire queued during cooldown, then a new one)
      expect(wakeSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ======================================================================
  // registerRecurringSchedule
  // ======================================================================

  describe("registerRecurringSchedule", () => {
    it("should register a single schedule timer", () => {
      const schedule = makeSchedule({
        nextFireAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const store = makeMockStore();

      engine.registerRecurringSchedule(schedule, store);

      vi.advanceTimersByTime(60_000);
      expect(wakeSpy).toHaveBeenCalledOnce();
      const reason: WakeReason = wakeSpy.mock.calls[0]![0];
      expect(reason.type).toBe("recurring");
      expect(reason.reason).toBe("Health check");
    });
  });

  // ======================================================================
  // cancelRecurringSchedule
  // ======================================================================

  describe("cancelRecurringSchedule", () => {
    it("should cancel a registered schedule timer", () => {
      const schedule = makeSchedule({
        nextFireAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const store = makeMockStore();

      engine.registerRecurringSchedule(schedule, store);
      engine.cancelRecurringSchedule(schedule.id);

      vi.advanceTimersByTime(60_000);
      expect(wakeSpy).not.toHaveBeenCalled();
    });

    it("should not crash when cancelling non-existent ID", () => {
      expect(() => {
        engine.cancelRecurringSchedule("nonexistent");
      }).not.toThrow();
    });
  });

  // ======================================================================
  // destroy
  // ======================================================================

  describe("destroy clears recurring timers", () => {
    it("should clear all recurring timers on destroy", () => {
      const schedule = makeSchedule({
        nextFireAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const store = makeMockStore([schedule]);

      engine.loadRecurringSchedules(store);
      engine.destroy();

      vi.advanceTimersByTime(60_000);
      expect(wakeSpy).not.toHaveBeenCalled();
    });
  });

  // ======================================================================
  // getPendingSchedule — recurringSchedules
  // ======================================================================

  describe("getPendingSchedule", () => {
    it("should include recurringSchedules from the cron store", () => {
      const schedule = makeSchedule({
        id: "sched-abc",
        cronExpr: "*/30 * * * *",
        reason: "Check agent health",
        nextFireAt: "2026-03-24T12:30:00.000Z",
        fireCount: 2,
        maxFires: 10,
        enabled: true,
      });
      const store = makeMockStore([schedule]);

      engine.loadRecurringSchedules(store);
      const pending = engine.getPendingSchedule();

      expect(pending.recurringSchedules).toHaveLength(1);
      expect(pending.recurringSchedules[0]).toEqual({
        id: "sched-abc",
        cronExpr: "*/30 * * * *",
        reason: "Check agent health",
        nextFireAt: "2026-03-24T12:30:00.000Z",
        fireCount: 2,
        maxFires: 10,
        enabled: true,
      });
    });

    it("should return empty recurringSchedules when no cron store is set", () => {
      const pending = engine.getPendingSchedule();
      expect(pending.recurringSchedules).toEqual([]);
    });

    it("should return multiple recurring schedules", () => {
      const s1 = makeSchedule({ id: "s1", reason: "Health check" });
      const s2 = makeSchedule({ id: "s2", reason: "Cost report", cronExpr: "0 * * * *" });
      const store = makeMockStore([s1, s2]);

      engine.loadRecurringSchedules(store);
      const pending = engine.getPendingSchedule();

      expect(pending.recurringSchedules).toHaveLength(2);
      expect(pending.recurringSchedules.map((s: PendingRecurringSchedule) => s.id)).toEqual(["s1", "s2"]);
    });
  });

  // ======================================================================
  // setupRecurringTimer — drift fix (adj-121.5.1)
  // ======================================================================

  describe("recurring timer drift fix", () => {
    it("should compute next fire from fire time, not wall clock", () => {
      const schedule = makeSchedule({
        nextFireAt: new Date(Date.now() + 1000).toISOString(),
        cronExpr: "*/15 * * * *",
      });
      const store = makeMockStore([schedule]);

      engine.loadRecurringSchedules(store);
      vi.advanceTimersByTime(1000);

      // incrementFireCount should have been called with a nextFireAt
      // that is 15 minutes from the fire time, not from an arbitrary later time
      expect(store.incrementFireCount).toHaveBeenCalledOnce();
      const [, lastFiredAt, nextFireAt] = (store.incrementFireCount as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const lastFiredMs = new Date(lastFiredAt as string).getTime();
      const nextFireMs = new Date(nextFireAt as string).getTime();

      // Next fire should be exactly 15 minutes after lastFiredAt
      expect(nextFireMs - lastFiredMs).toBe(15 * 60 * 1000);
    });
  });

  // ======================================================================
  // setupRecurringTimer — try-catch (adj-121.1.1)
  // ======================================================================

  describe("recurring timer error handling", () => {
    it("should not throw when store.incrementFireCount throws", () => {
      const schedule = makeSchedule({
        nextFireAt: new Date(Date.now() + 1000).toISOString(),
      });
      const store = makeMockStore([schedule]);
      (store.incrementFireCount as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("DB write failed");
      });

      engine.loadRecurringSchedules(store);

      // Should not throw — timer callback has try-catch
      expect(() => {
        vi.advanceTimersByTime(1000);
      }).not.toThrow();

      // Wake should still have been called (it happens before incrementFireCount)
      expect(wakeSpy).toHaveBeenCalledOnce();
    });
  });
});

// ========================================================================
// buildSituationPrompt — recurring schedules section (adj-121.5.3)
// ========================================================================

describe("buildSituationPrompt — recurring schedules", () => {
  function makePromptInput(
    overrides: Partial<SituationPromptInput> = {},
  ): SituationPromptInput {
    return {
      wakeReason: "Test wake",
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
      pendingSchedule: {
        checks: [],
        watches: [],
        recurringSchedules: [],
      },
      recentDecisions: [],
      ...overrides,
    };
  }

  it("should render Recurring Schedules section when schedules are present", () => {
    const input = makePromptInput({
      pendingSchedule: {
        checks: [],
        watches: [],
        recurringSchedules: [
          {
            id: "s1",
            cronExpr: "*/15 * * * *",
            reason: "Health check",
            nextFireAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            fireCount: 3,
            maxFires: null,
            enabled: true,
          },
          {
            id: "s2",
            cronExpr: "0 * * * *",
            reason: "Cost report",
            nextFireAt: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
            fireCount: 1,
            maxFires: 5,
            enabled: true,
          },
        ],
      },
    });

    const result = buildSituationPrompt(input);

    expect(result).toContain("## Recurring");
    expect(result).toContain("Health check");
    expect(result).toContain("Cost report");
    expect(result).toContain("fired 3x");
    expect(result).toContain("fired 1x");
  });

  it("should not render Recurring section when no schedules exist", () => {
    const input = makePromptInput({
      pendingSchedule: {
        checks: [],
        watches: [],
        recurringSchedules: [],
      },
    });

    const result = buildSituationPrompt(input);
    expect(result).not.toContain("## Recurring");
  });

  it("should show interval label derived from cron expression", () => {
    const input = makePromptInput({
      pendingSchedule: {
        checks: [],
        watches: [],
        recurringSchedules: [
          {
            id: "s1",
            cronExpr: "0 * * * *",
            reason: "Hourly report",
            nextFireAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            fireCount: 0,
            maxFires: null,
            enabled: true,
          },
        ],
      },
    });

    const result = buildSituationPrompt(input);
    // "0 * * * *" = 60 minutes = "1h"
    expect(result).toContain("Every 1h");
  });
});
