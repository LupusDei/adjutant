/**
 * Stimulus Engine — reactive prompt injection for the adjutant agent.
 *
 * Three wake sources:
 * 1. Critical signals (from SignalAggregator) — immediate wake
 * 2. Scheduled checks (setTimeout-based) — adjutant-specified delays
 * 3. Event watches (conditional EventBus listeners) — fire on matching events
 *
 * All wakes are subject to a 90-second cooldown to prevent prompt flooding.
 * Queued wakes fire immediately when cooldown expires.
 */

import { randomUUID } from "crypto";

import type { EventName } from "../event-bus.js";
import type { Signal } from "./signal-aggregator.js";

// ============================================================================
// Types
// ============================================================================

export interface WakeReason {
  /** What caused the wake */
  type: "critical" | "scheduled" | "watch" | "watch_timeout" | "bootstrap";
  /** Human-readable reason */
  reason?: string;
  /** The critical signal that triggered the wake (for type "critical") */
  signal?: Signal;
  /** The event name that matched (for type "watch") */
  watchEvent?: EventName;
  /** The event data that matched (for type "watch") */
  watchData?: unknown;
}

export type WakeCallback = (reason: WakeReason) => void;

export interface PendingCheck {
  id: string;
  reason: string;
  firesAt: number;
  scheduledAt: number;
}

export interface PendingWatch {
  id: string;
  event: EventName;
  filter?: Record<string, unknown>;
  timeoutMs?: number;
  reason?: string;
  registeredAt: number;
}

export interface PendingSchedule {
  checks: PendingCheck[];
  watches: PendingWatch[];
}

// ============================================================================
// Internal types
// ============================================================================

interface ScheduledCheck {
  id: string;
  reason: string;
  firesAt: number;
  scheduledAt: number;
  timer: ReturnType<typeof setTimeout>;
}

interface EventWatch {
  id: string;
  event: EventName;
  filter?: Record<string, unknown>;
  timeoutMs?: number;
  reason?: string;
  registeredAt: number;
  timeoutTimer?: ReturnType<typeof setTimeout>;
}

// ============================================================================
// Constants
// ============================================================================

/** Cooldown between prompts: 90 seconds */
const COOLDOWN_MS = 90_000;

// ============================================================================
// StimulusEngine
// ============================================================================

export class StimulusEngine {
  private wakeCallbacks: WakeCallback[] = [];
  private scheduledChecks: Map<string, ScheduledCheck> = new Map();
  private eventWatches: Map<string, EventWatch> = new Map();
  private lastWakeAt = 0;
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private cooldownQueue: WakeReason[] = [];

  /**
   * Register a callback to be called when the adjutant should be woken.
   */
  onWake(callback: WakeCallback): void {
    this.wakeCallbacks.push(callback);
  }

  /**
   * Handle a critical signal from the SignalAggregator.
   * Fires immediately or queues for after cooldown.
   */
  handleCriticalSignal(signal: Signal): void {
    const reason: WakeReason = {
      type: "critical",
      reason: `Critical: ${signal.event}`,
      signal,
    };
    this.wake(reason);
  }

  /**
   * Schedule a delayed wake. Returns a check ID for cancellation.
   */
  scheduleCheck(delayMs: number, reason: string): string {
    const id = randomUUID();
    const now = Date.now();
    const firesAt = now + delayMs;

    const timer = setTimeout(() => {
      this.scheduledChecks.delete(id);
      const wakeReason: WakeReason = {
        type: "scheduled",
        reason,
      };
      this.wake(wakeReason);
    }, delayMs);

    this.scheduledChecks.set(id, {
      id,
      reason,
      firesAt,
      scheduledAt: now,
      timer,
    });

    return id;
  }

  /**
   * Cancel a scheduled check.
   */
  cancelCheck(id: string): void {
    const check = this.scheduledChecks.get(id);
    if (check) {
      clearTimeout(check.timer);
      this.scheduledChecks.delete(id);
    }
  }

  /**
   * Register a conditional event watch.
   * Fires when a matching event is triggered via triggerWatch().
   * Optionally times out after timeoutMs.
   */
  registerWatch(
    event: EventName,
    filter?: Record<string, unknown>,
    timeoutMs?: number,
    reason?: string,
  ): string {
    const id = randomUUID();
    const now = Date.now();

    const watch: EventWatch = {
      id,
      event,
      registeredAt: now,
    };
    if (filter !== undefined) watch.filter = filter;
    if (timeoutMs !== undefined) watch.timeoutMs = timeoutMs;
    if (reason !== undefined) watch.reason = reason;

    if (timeoutMs != null) {
      watch.timeoutTimer = setTimeout(() => {
        this.eventWatches.delete(id);
        const wakeReason: WakeReason = {
          type: "watch_timeout",
          reason: reason ? `Watch timeout: ${reason}` : `Watch timeout: ${event}`,
          watchEvent: event,
        };
        this.wake(wakeReason);
      }, timeoutMs);
    }

    this.eventWatches.set(id, watch);
    return id;
  }

  /**
   * Cancel an event watch.
   */
  cancelWatch(id: string): void {
    const watch = this.eventWatches.get(id);
    if (watch) {
      if (watch.timeoutTimer) {
        clearTimeout(watch.timeoutTimer);
      }
      this.eventWatches.delete(id);
    }
  }

  /**
   * Trigger watches for a given event. Called by external code (e.g., EventBus listener).
   * Fires matching watches and removes them (one-shot).
   */
  triggerWatch(event: EventName, data: unknown): void {
    for (const [id, watch] of this.eventWatches) {
      if (watch.event !== event) continue;

      // Check filter
      if (watch.filter) {
        const payload = data as Record<string, unknown> | null;
        if (!payload) continue;
        const matches = Object.entries(watch.filter).every(
          ([key, value]) => payload[key] === value,
        );
        if (!matches) continue;
      }

      // Match found — remove watch and fire
      if (watch.timeoutTimer) {
        clearTimeout(watch.timeoutTimer);
      }
      this.eventWatches.delete(id);

      const wakeReason: WakeReason = {
        type: "watch",
        watchEvent: event,
        watchData: data,
      };
      if (watch.reason !== undefined) wakeReason.reason = watch.reason;
      this.wake(wakeReason);
    }
  }

  /**
   * Get pending checks and watches for inclusion in prompts.
   */
  getPendingSchedule(): PendingSchedule {
    const checks: PendingCheck[] = [];
    for (const check of this.scheduledChecks.values()) {
      checks.push({
        id: check.id,
        reason: check.reason,
        firesAt: check.firesAt,
        scheduledAt: check.scheduledAt,
      });
    }

    const watches: PendingWatch[] = [];
    for (const watch of this.eventWatches.values()) {
      const entry: PendingWatch = {
        id: watch.id,
        event: watch.event,
        registeredAt: watch.registeredAt,
      };
      if (watch.filter !== undefined) entry.filter = watch.filter;
      if (watch.timeoutMs !== undefined) entry.timeoutMs = watch.timeoutMs;
      if (watch.reason !== undefined) entry.reason = watch.reason;
      watches.push(entry);
    }

    return { checks, watches };
  }

  /**
   * Clean up all timers.
   */
  destroy(): void {
    for (const check of this.scheduledChecks.values()) {
      clearTimeout(check.timer);
    }
    this.scheduledChecks.clear();

    for (const watch of this.eventWatches.values()) {
      if (watch.timeoutTimer) {
        clearTimeout(watch.timeoutTimer);
      }
    }
    this.eventWatches.clear();

    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    this.cooldownQueue = [];
  }

  // ============================================================================
  // Private
  // ============================================================================

  /**
   * Fire a wake or queue it if within cooldown.
   */
  private wake(reason: WakeReason): void {
    const now = Date.now();
    const elapsed = now - this.lastWakeAt;

    if (elapsed >= COOLDOWN_MS) {
      this.fireWake(reason);
    } else {
      // Queue for after cooldown
      this.cooldownQueue.push(reason);
      this.ensureCooldownTimer(COOLDOWN_MS - elapsed);
    }
  }

  /**
   * Actually fire the wake callbacks.
   */
  private fireWake(reason: WakeReason): void {
    this.lastWakeAt = Date.now();
    for (const cb of this.wakeCallbacks) {
      try {
        cb(reason);
      } catch {
        // Callbacks must not break the engine
      }
    }
  }

  /**
   * Ensure the cooldown drain timer is running.
   */
  private ensureCooldownTimer(delayMs: number): void {
    if (this.cooldownTimer) return;

    this.cooldownTimer = setTimeout(() => {
      this.cooldownTimer = null;
      if (this.cooldownQueue.length > 0) {
        // Fire the latest queued reason (most recent signal is most relevant)
        const reason = this.cooldownQueue[this.cooldownQueue.length - 1]!;
        this.cooldownQueue = [];
        this.fireWake(reason);
      }
    }, delayMs);
  }
}
