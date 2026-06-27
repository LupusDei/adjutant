/**
 * adj-202.3.3 — Tests for the Bridge avatar cost guard.
 *
 * The cost guard bounds avatar spend (real money — Runway credits) so a forgotten or
 * idle session cannot burn the credit grant. It is PURE, in-memory logic with an
 * injectable clock; the session layer wires it to real sessions. Three concerns:
 *
 *   1. Per-day credit circuit-breaker — trips (blocks new sessions) once a configurable
 *      daily credit ceiling is reached; resets on the next calendar (UTC) day.
 *   2. Idle auto-disconnect — a pure predicate the session layer polls to decide when to
 *      cut a session that has gone quiet past a configurable idle timeout.
 *   3. Live meter accounting — credits/cost for an elapsed session, billed exactly as
 *      Runway bills GWM-1: 2 credits up front + 2 credits per 6-second block (≈ $0.20/min).
 *
 * Tests are written FIRST (RED) against the not-yet-implemented module. Time is driven by
 * an injected `nowFn` so there is zero real-time dependence.
 */

import { describe, expect, it } from "vitest";

import {
  BridgeCostGuard,
  computeSessionMeter,
  isSessionIdle,
  DEFAULT_COST_MODEL,
  DEFAULT_DAILY_CREDIT_CEILING,
  DEFAULT_IDLE_TIMEOUT_MS,
} from "../../src/services/bridge-cost-guard.js";

/** A controllable clock for deterministic tests. */
function fakeClock(start = 0): { now: () => number; set: (t: number) => void; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    set: (next: number): void => {
      t = next;
    },
    advance: (ms: number): void => {
      t += ms;
    },
  };
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

describe("computeSessionMeter", () => {
  it("should charge only the upfront credits at 0 seconds elapsed", () => {
    const meter = computeSessionMeter(0);
    expect(meter.elapsedSeconds).toBe(0);
    expect(meter.blocks).toBe(0);
    expect(meter.credits).toBe(2); // 2 upfront + 0 streaming
    expect(meter.dollars).toBeCloseTo(0.02, 6);
  });

  it("should charge one streaming block at exactly 6 seconds", () => {
    const meter = computeSessionMeter(6_000);
    expect(meter.elapsedSeconds).toBe(6);
    expect(meter.blocks).toBe(1);
    expect(meter.credits).toBe(4); // 2 upfront + 2 streaming
    expect(meter.dollars).toBeCloseTo(0.04, 6);
  });

  it("should compute 102 credits (~$0.20/min) for a full 5-minute session", () => {
    const meter = computeSessionMeter(5 * 60 * 1000);
    expect(meter.elapsedSeconds).toBe(300);
    expect(meter.blocks).toBe(50);
    expect(meter.credits).toBe(102); // 2 upfront + 100 streaming
    // 100 streaming credits over 5 min = $1.00 = $0.20/min, +$0.02 upfront
    expect(meter.dollars).toBeCloseTo(1.02, 6);
  });

  it("should round a partial block UP (conservative spend bounding)", () => {
    // 7s falls in the 2nd 6s block → charged for 2 blocks, never 1.x
    const meter = computeSessionMeter(7_000);
    expect(meter.blocks).toBe(2);
    expect(meter.credits).toBe(6); // 2 upfront + 4 streaming
  });

  it("should clamp negative elapsed time to zero", () => {
    const meter = computeSessionMeter(-5_000);
    expect(meter.elapsedSeconds).toBe(0);
    expect(meter.blocks).toBe(0);
    expect(meter.credits).toBe(DEFAULT_COST_MODEL.upfrontCredits);
  });

  it("should honor an overridden cost model", () => {
    const meter = computeSessionMeter(12_000, {
      upfrontCredits: 5,
      creditsPerBlock: 3,
      blockSeconds: 6,
      dollarsPerCredit: 0.1,
    });
    expect(meter.blocks).toBe(2);
    expect(meter.credits).toBe(11); // 5 + 3*2
    expect(meter.dollars).toBeCloseTo(1.1, 6);
  });
});

describe("isSessionIdle", () => {
  const TIMEOUT = 120_000;

  it("should NOT be idle just before the timeout", () => {
    const now = 1_000_000;
    expect(isSessionIdle(now - (TIMEOUT - 1), now, TIMEOUT)).toBe(false);
  });

  it("should be idle at exactly the timeout boundary", () => {
    const now = 1_000_000;
    expect(isSessionIdle(now - TIMEOUT, now, TIMEOUT)).toBe(true);
  });

  it("should be idle well past the timeout", () => {
    const now = 1_000_000;
    expect(isSessionIdle(now - (TIMEOUT + 5_000), now, TIMEOUT)).toBe(true);
  });

  it("should not be idle when activity is in the (skewed) future", () => {
    const now = 1_000_000;
    expect(isSessionIdle(now + 5_000, now, TIMEOUT)).toBe(false);
  });
});

describe("BridgeCostGuard — credit circuit-breaker", () => {
  it("should allow starting a session when no credits have been spent", () => {
    const guard = new BridgeCostGuard({ dailyCreditCeiling: 100, nowFn: fakeClock().now });
    expect(guard.canStartSession()).toBe(true);
    expect(guard.spentToday()).toBe(0);
    expect(guard.remainingCreditsToday()).toBe(100);
  });

  it("should accumulate recorded spend within the same day", () => {
    const guard = new BridgeCostGuard({ dailyCreditCeiling: 100, nowFn: fakeClock(0).now });
    guard.recordSpend(30);
    guard.recordSpend(20);
    expect(guard.spentToday()).toBe(50);
    expect(guard.remainingCreditsToday()).toBe(50);
    expect(guard.canStartSession()).toBe(true);
  });

  it("should TRIP at exactly the ceiling (boundary — not strictly above)", () => {
    const guard = new BridgeCostGuard({ dailyCreditCeiling: 100, nowFn: fakeClock(0).now });
    guard.recordSpend(100);
    expect(guard.spentToday()).toBe(100);
    expect(guard.remainingCreditsToday()).toBe(0);
    expect(guard.canStartSession()).toBe(false); // reached the ceiling → blocked
  });

  it("should stay tripped once spend exceeds the ceiling", () => {
    const guard = new BridgeCostGuard({ dailyCreditCeiling: 100, nowFn: fakeClock(0).now });
    guard.recordSpend(150);
    expect(guard.remainingCreditsToday()).toBe(0); // clamped, never negative
    expect(guard.canStartSession()).toBe(false);
  });

  it("should reset the daily counter when the calendar day rolls over", () => {
    const clock = fakeClock(0);
    const guard = new BridgeCostGuard({ dailyCreditCeiling: 100, nowFn: clock.now });
    guard.recordSpend(100);
    expect(guard.canStartSession()).toBe(false);

    clock.advance(ONE_DAY_MS); // next calendar day
    expect(guard.spentToday()).toBe(0);
    expect(guard.canStartSession()).toBe(true);
  });

  it("should keep the counter within the same day even as the clock advances", () => {
    const clock = fakeClock(0);
    const guard = new BridgeCostGuard({ dailyCreditCeiling: 100, nowFn: clock.now });
    guard.recordSpend(40);
    clock.advance(60 * 60 * 1000); // +1 hour, still same UTC day
    expect(guard.spentToday()).toBe(40);
  });

  it("should reject a negative spend amount", () => {
    const guard = new BridgeCostGuard({ dailyCreditCeiling: 100, nowFn: fakeClock(0).now });
    expect(() => {
      guard.recordSpend(-1);
    }).toThrow();
  });

  it("should reject a non-finite spend amount", () => {
    const guard = new BridgeCostGuard({ dailyCreditCeiling: 100, nowFn: fakeClock(0).now });
    expect(() => {
      guard.recordSpend(Number.NaN);
    }).toThrow();
  });
});

describe("BridgeCostGuard — idle disconnect", () => {
  it("should not disconnect a session active within the idle timeout", () => {
    const clock = fakeClock(1_000_000);
    const guard = new BridgeCostGuard({ idleTimeoutMs: 120_000, nowFn: clock.now });
    expect(guard.shouldDisconnectIdle(clock.now() - 119_999)).toBe(false);
  });

  it("should disconnect a session idle at/after the timeout", () => {
    const clock = fakeClock(1_000_000);
    const guard = new BridgeCostGuard({ idleTimeoutMs: 120_000, nowFn: clock.now });
    expect(guard.shouldDisconnectIdle(clock.now() - 120_000)).toBe(true);
    clock.advance(10_000);
    expect(guard.shouldDisconnectIdle(clock.now() - 130_000)).toBe(true);
  });
});

describe("BridgeCostGuard — meter passthrough + spend recording", () => {
  it("should expose the meter for an elapsed session using its cost model", () => {
    const guard = new BridgeCostGuard({ nowFn: fakeClock(0).now });
    const meter = guard.meter(6_000);
    expect(meter.credits).toBe(4);
    expect(meter.blocks).toBe(1);
  });

  it("should record a session's metered credits against the daily ceiling", () => {
    const guard = new BridgeCostGuard({ dailyCreditCeiling: 100, nowFn: fakeClock(0).now });
    guard.recordSessionSpend(6_000); // 4 credits
    expect(guard.spentToday()).toBe(4);
    expect(guard.remainingCreditsToday()).toBe(96);
  });
});

describe("BridgeCostGuard — defaults", () => {
  it("should fall back to documented defaults when no config is supplied", () => {
    const guard = new BridgeCostGuard();
    expect(guard.remainingCreditsToday()).toBe(DEFAULT_DAILY_CREDIT_CEILING);
    // default idle timeout is exported and used by the predicate
    expect(DEFAULT_IDLE_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
