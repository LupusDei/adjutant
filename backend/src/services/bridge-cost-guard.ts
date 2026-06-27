/**
 * Bridge avatar cost guard (adj-202.3.3).
 *
 * Bounds avatar spend — this guards REAL MONEY (Runway credits) — so a forgotten or idle
 * GWM-1 session cannot burn through the credit grant. It is intentionally PURE, in-memory
 * logic with an injectable clock (`nowFn`); the session/broker layer wires it to live
 * sessions and persists any durable accounting. No I/O lives here.
 *
 * Three concerns:
 *   1. Per-day credit circuit-breaker — `canStartSession()` / `recordSpend()` trip once a
 *      configurable daily credit ceiling is reached, and reset on the next calendar (UTC) day.
 *   2. Idle auto-disconnect — `shouldDisconnectIdle()` / the pure `isSessionIdle()` predicate
 *      tell the session layer when a quiet session has passed its idle timeout.
 *   3. Live meter accounting — `meter()` / the pure `computeSessionMeter()` compute the
 *      credits and dollar cost of an elapsed session.
 *
 * Cost model (Runway GWM-1, from specs/060-the-bridge-voice-coordinator/research.md):
 *   - 2 credits charged up front per session.
 *   - 2 credits per 6-second streaming block (≈ 20 credits/min ≈ $0.20/min ⇒ ~$0.01/credit).
 * Partial blocks are billed UP (a started 6s block costs a full 2 credits), matching how the
 * provider bills and keeping the guard conservative: it never under-counts spend.
 */

/** The credit/dollar cost model for an avatar session. */
export interface CostModel {
  /** Credits charged once when a session is created. */
  upfrontCredits: number;
  /** Credits charged per streaming block. */
  creditsPerBlock: number;
  /** Seconds per streaming block. */
  blockSeconds: number;
  /** USD per credit (for the live cost meter). */
  dollarsPerCredit: number;
}

/**
 * Runway GWM-1 defaults: 2 credits up front, 2 credits / 6s, ~$0.01/credit.
 * 2 credits / 6s = 20 credits/min, and $0.20/min ÷ 20 credits/min = $0.01/credit.
 */
export const DEFAULT_COST_MODEL: CostModel = {
  upfrontCredits: 2,
  creditsPerBlock: 2,
  blockSeconds: 6,
  dollarsPerCredit: 0.01,
};

/**
 * Default per-day credit ceiling. 1000 credits ≈ $10/day ≈ 50 minutes of avatar time.
 * Tunable per deployment; the broker should override from config once a policy is set.
 */
export const DEFAULT_DAILY_CREDIT_CEILING = 1000;

/** Default idle timeout: cut a session quiet for 2 minutes. */
export const DEFAULT_IDLE_TIMEOUT_MS = 120_000;

/** Number of whole milliseconds in one calendar day (used for UTC day bucketing). */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Live meter snapshot for an elapsed session. */
export interface SessionMeter {
  /** Wall-clock seconds elapsed (clamped to ≥ 0). */
  elapsedSeconds: number;
  /** Number of (rounded-up) streaming blocks billed. */
  blocks: number;
  /** Total credits = upfront + blocks × creditsPerBlock. */
  credits: number;
  /** Total dollar cost = credits × dollarsPerCredit. */
  dollars: number;
}

/**
 * Compute the credits/cost for a session that has run `elapsedMs` milliseconds.
 *
 * Pure. Negative elapsed time (clock skew) clamps to zero. Partial 6s blocks round UP so the
 * meter never under-reports what the provider will bill.
 */
export function computeSessionMeter(elapsedMs: number, model: Partial<CostModel> = {}): SessionMeter {
  const m: CostModel = { ...DEFAULT_COST_MODEL, ...model };
  const safeElapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const elapsedSeconds = safeElapsedMs / 1000;
  const blocks = m.blockSeconds > 0 ? Math.ceil(elapsedSeconds / m.blockSeconds) : 0;
  const credits = m.upfrontCredits + blocks * m.creditsPerBlock;
  const dollars = credits * m.dollarsPerCredit;
  return { elapsedSeconds, blocks, credits, dollars };
}

/**
 * Pure predicate: has a session been idle for at least `idleTimeoutMs`?
 *
 * `now - lastActivityAt >= idleTimeoutMs` — fires AT the boundary and after. Future-dated
 * activity (clock skew) is treated as "not idle".
 */
export function isSessionIdle(lastActivityAt: number, now: number, idleTimeoutMs: number): boolean {
  return now - lastActivityAt >= idleTimeoutMs;
}

/** Construction options for {@link BridgeCostGuard}. All optional; documented defaults apply. */
export interface BridgeCostGuardConfig {
  /** Hard per-day credit ceiling. New sessions are blocked once today's spend reaches it. */
  dailyCreditCeiling: number;
  /** Idle timeout (ms) for {@link BridgeCostGuard.shouldDisconnectIdle}. */
  idleTimeoutMs: number;
  /** Cost model for the meter. */
  costModel: CostModel;
  /** Injectable clock returning epoch milliseconds. Defaults to `Date.now`. */
  nowFn: () => number;
}

/**
 * Stateful cost guard for avatar sessions. Holds the rolling daily credit tally in memory and
 * resets it across UTC calendar-day boundaries. One instance bounds spend across all sessions.
 */
export class BridgeCostGuard {
  private readonly dailyCreditCeiling: number;
  private readonly idleTimeoutMs: number;
  private readonly costModel: CostModel;
  private readonly nowFn: () => number;

  /** UTC day index (epoch-days) the current tally belongs to. */
  private currentDay: number;
  /** Credits spent during `currentDay`. */
  private creditsSpent: number;

  constructor(config: Partial<BridgeCostGuardConfig> = {}) {
    this.dailyCreditCeiling = config.dailyCreditCeiling ?? DEFAULT_DAILY_CREDIT_CEILING;
    this.idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.costModel = config.costModel ?? DEFAULT_COST_MODEL;
    this.nowFn = config.nowFn ?? Date.now;
    this.currentDay = this.dayIndex();
    this.creditsSpent = 0;
  }

  /** Epoch-day bucket for the current clock value (UTC calendar day). */
  private dayIndex(): number {
    return Math.floor(this.nowFn() / ONE_DAY_MS);
  }

  /** Roll the tally to today, resetting it if the calendar day has changed. */
  private rollDay(): void {
    const today = this.dayIndex();
    if (today !== this.currentDay) {
      this.currentDay = today;
      this.creditsSpent = 0;
    }
  }

  /** Whether a new session may start: true while today's spend is below the ceiling. */
  canStartSession(): boolean {
    this.rollDay();
    return this.creditsSpent < this.dailyCreditCeiling;
  }

  /** Record raw credits spent against today's tally. Rejects negative / non-finite amounts. */
  recordSpend(credits: number): void {
    if (!Number.isFinite(credits) || credits < 0) {
      throw new Error(`recordSpend requires a finite, non-negative credit amount, got: ${credits}`);
    }
    this.rollDay();
    this.creditsSpent += credits;
  }

  /** Convenience: meter an elapsed session and record its credits in one call. */
  recordSessionSpend(elapsedMs: number): void {
    this.recordSpend(this.meter(elapsedMs).credits);
  }

  /** Credits spent so far today. */
  spentToday(): number {
    this.rollDay();
    return this.creditsSpent;
  }

  /** Credits remaining before the ceiling trips today (never negative). */
  remainingCreditsToday(): number {
    this.rollDay();
    return Math.max(0, this.dailyCreditCeiling - this.creditsSpent);
  }

  /** Live meter for an elapsed session using this guard's cost model. */
  meter(elapsedMs: number): SessionMeter {
    return computeSessionMeter(elapsedMs, this.costModel);
  }

  /** Whether a session last active at `lastActivityAt` should be disconnected for idleness. */
  shouldDisconnectIdle(lastActivityAt: number): boolean {
    return isSessionIdle(lastActivityAt, this.nowFn(), this.idleTimeoutMs);
  }
}
