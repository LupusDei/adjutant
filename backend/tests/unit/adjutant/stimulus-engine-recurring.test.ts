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
  type WakeReason,
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
});
