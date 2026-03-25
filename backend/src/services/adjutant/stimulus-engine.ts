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
import type { Signal, SignalSnapshot } from "./signal-aggregator.js";
import type { DecisionEntry } from "./state-store.js";
import type { CronScheduleStore, CronSchedule } from "./cron-schedule-store.js";
import { computeNextFireAt } from "./cron-schedule-store.js";
import { cronToIntervalMs } from "./adjutant-core.js";

// ============================================================================
// Types
// ============================================================================

export interface WakeReason {
  /** What caused the wake */
  type: "critical" | "scheduled" | "watch" | "watch_timeout" | "bootstrap" | "recurring";
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

export interface PendingRecurringSchedule {
  id: string;
  cronExpr: string;
  reason: string;
  nextFireAt: string;
  fireCount: number;
  maxFires: number | null;
  enabled: boolean;
}

export interface PendingSchedule {
  checks: PendingCheck[];
  watches: PendingWatch[];
  recurringSchedules: PendingRecurringSchedule[];
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
  private scheduledChecks = new Map<string, ScheduledCheck>();
  private eventWatches = new Map<string, EventWatch>();
  private recurringTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private cronStore?: CronScheduleStore;
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
   * Load all enabled recurring schedules from the store and register timers.
   */
  loadRecurringSchedules(store: CronScheduleStore): void {
    this.cronStore = store;
    const schedules = store.listEnabled();
    for (const schedule of schedules) {
      this.setupRecurringTimer(schedule, store);
    }
  }

  /**
   * Register a single recurring schedule timer (called after create via MCP tools).
   */
  registerRecurringSchedule(schedule: CronSchedule, store: CronScheduleStore): void {
    this.cronStore = store;
    this.setupRecurringTimer(schedule, store);
  }

  /**
   * Cancel a recurring schedule timer.
   */
  cancelRecurringSchedule(id: string): void {
    const timer = this.recurringTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.recurringTimers.delete(id);
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

    const recurringSchedules: PendingRecurringSchedule[] = [];
    if (this.cronStore) {
      for (const schedule of this.cronStore.listEnabled()) {
        recurringSchedules.push({
          id: schedule.id,
          cronExpr: schedule.cronExpr,
          reason: schedule.reason,
          nextFireAt: schedule.nextFireAt,
          fireCount: schedule.fireCount,
          maxFires: schedule.maxFires,
          enabled: schedule.enabled,
        });
      }
    }

    return { checks, watches, recurringSchedules };
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

    for (const timer of this.recurringTimers.values()) {
      clearTimeout(timer);
    }
    this.recurringTimers.clear();

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
   * Set up a timer for a recurring schedule. Fires, increments, and re-registers.
   */
  private setupRecurringTimer(schedule: CronSchedule, store: CronScheduleStore): void {
    const nextFireMs = new Date(schedule.nextFireAt).getTime();
    const delayMs = Math.max(0, nextFireMs - Date.now());

    const timer = setTimeout(() => {
      this.recurringTimers.delete(schedule.id);

      try {
        // Fire the wake
        const wakeReason: WakeReason = {
          type: "recurring",
          reason: schedule.reason,
        };
        this.wake(wakeReason);

        // Increment fire count in the store — compute next from lastFiredAt to avoid drift
        const now = new Date();
        const nowIso = now.toISOString();
        const newNextFireAt = computeNextFireAt(schedule.cronExpr, now);
        store.incrementFireCount(schedule.id, nowIso, newNextFireAt);

        // Check if maxFires reached (current fire count is fireCount + 1 since we just incremented)
        const newFireCount = schedule.fireCount + 1;
        if (schedule.maxFires !== null && newFireCount >= schedule.maxFires) {
          store.disable(schedule.id);
          return;
        }

        // Re-register for next fire
        const updatedSchedule: CronSchedule = {
          ...schedule,
          fireCount: newFireCount,
          lastFiredAt: nowIso,
          nextFireAt: newNextFireAt,
        };
        this.setupRecurringTimer(updatedSchedule, store);
      } catch {
        // Timer callback must not break the engine — log and skip re-registration
      }
    }, delayMs);

    this.recurringTimers.set(schedule.id, timer);
  }

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

// ============================================================================
// State snapshot type for prompt building
// ============================================================================

export interface StateSnapshot {
  activeAgents: number;
  workingAgents: number;
  blockedAgents: number;
  idleAgents: number;
  inProgressBeads: number;
  readyBeads: number;
}

// ============================================================================
// Situation prompt builder
// ============================================================================

export interface SituationPromptInput {
  wakeReason: string;
  signals: Signal[];
  contextSnapshot: SignalSnapshot;
  stateSnapshot: StateSnapshot;
  pendingSchedule: PendingSchedule;
  recentDecisions: DecisionEntry[];
}

/**
 * Build the situation prompt for the adjutant.
 * Returns a single-line string for tmux injection.
 */
export function buildSituationPrompt(input: SituationPromptInput): string {
  const lines: string[] = [];

  lines.push(`SITUATION -- ${input.wakeReason}`);
  lines.push("");

  // What Happened
  lines.push("## What Happened");
  for (const signal of input.signals) {
    const summary = summarizeSignalData(signal);
    lines.push(`- [CRITICAL] ${signal.event} -- ${summary}`);
  }
  for (const [eventName, signals] of Object.entries(input.contextSnapshot)) {
    for (const signal of signals) {
      const summary = summarizeSignalData(signal);
      const countStr = signal.count > 1 ? ` (x${signal.count})` : "";
      lines.push(`- [context] ${eventName} -- ${summary}${countStr}`);
    }
  }
  if (input.signals.length === 0 && Object.keys(input.contextSnapshot).length === 0) {
    lines.push("- No recent events");
  }
  lines.push("");

  // Current State
  const st = input.stateSnapshot;
  lines.push("## Current State");
  lines.push(`Active agents: ${st.activeAgents} (${st.workingAgents} working, ${st.blockedAgents} blocked, ${st.idleAgents} idle)`);
  lines.push(`In-progress beads: ${st.inProgressBeads}`);
  lines.push(`Ready beads: ${st.readyBeads}`);
  lines.push("");

  // Pending Schedule
  if (input.pendingSchedule.checks.length > 0 || input.pendingSchedule.watches.length > 0) {
    lines.push("## Pending");
    for (const check of input.pendingSchedule.checks) {
      const remainMs = check.firesAt - Date.now();
      const remainMin = Math.max(1, Math.round(remainMs / 60_000));
      lines.push(`- In ${remainMin}m: ${check.reason}`);
    }
    for (const watch of input.pendingSchedule.watches) {
      const reason = watch.reason ?? watch.event;
      lines.push(`- Watch: ${reason}`);
    }
    lines.push("");
  }

  // Recurring Schedules
  // recurringSchedules may be absent in legacy callers that haven't been updated
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (input.pendingSchedule.recurringSchedules && input.pendingSchedule.recurringSchedules.length > 0) {
    lines.push("## Recurring");
    for (const sched of input.pendingSchedule.recurringSchedules) {
      const intervalMs = cronToIntervalMs(sched.cronExpr);
      const intervalLabel = formatIntervalLabel(intervalMs);
      const remainMs = new Date(sched.nextFireAt).getTime() - Date.now();
      const remainMin = Math.max(1, Math.round(remainMs / 60_000));
      lines.push(`- Every ${intervalLabel}: ${sched.reason} (next: ${remainMin}m, fired ${sched.fireCount}x)`);
    }
    lines.push("");
  }

  // Recent Decisions (with outcomes if available)
  if (input.recentDecisions.length > 0) {
    lines.push("## Recent");
    for (const decision of input.recentDecisions) {
      const ago = formatAgo(decision.createdAt);
      const target = decision.target ? ` -> ${decision.target}` : "";
      const outcome = decision.outcome
        ? ` [${decision.outcome}]`
        : "";
      lines.push(`- ${ago}: ${decision.action}${target}${outcome}`);
    }
    lines.push("");
  }

  lines.push("Assess and act. Schedule follow-ups if needed.");

  // Collapse to single line for tmux injection
  return lines.join("\n").replace(/\n+/g, " ").trim();
}

// ============================================================================
// Bootstrap prompt builder
// ============================================================================

/**
 * Build the bootstrap prompt (fires once on startup).
 * Returns a single-line string for tmux injection.
 */
export function buildBootstrapPrompt(): string {
  const lines: string[] = [];

  lines.push("BOOTSTRAP -- Adjutant system starting up.");
  lines.push("");
  lines.push("Gather the current state (list_agents, list_beads) and assess:");
  lines.push("- Are any agents active? What are they working on?");
  lines.push("- Are there ready beads that need assignment?");
  lines.push("- Any anomalies?");
  lines.push("");
  lines.push("Take any immediate actions needed, then schedule your first check-ins using schedule_check.");
  lines.push("You will only be woken again by critical events or your own scheduled checks.");

  return lines.join("\n").replace(/\n+/g, " ").trim();
}

// ============================================================================
// Helpers
// ============================================================================

function summarizeSignalData(signal: Signal): string {
  const data = signal.data as Record<string, unknown> | null;
  if (!data) return "no data";

  const parts: string[] = [];
  if (data["agentId"]) parts.push(`agent "${String(data["agentId"])}"`);
  if (data["agent"]) parts.push(`agent "${String(data["agent"])}"`);
  if (data["id"]) parts.push(String(data["id"]));
  if (data["title"]) parts.push(`"${String(data["title"])}"`);
  if (data["exitCode"] !== undefined) parts.push(`exit ${String(data["exitCode"])}`);
  if (data["branch"]) parts.push(`branch ${String(data["branch"])}`);
  if (data["status"]) parts.push(`status: ${String(data["status"])}`);

  return parts.length > 0 ? parts.join(", ") : JSON.stringify(data);
}

function formatIntervalLabel(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function formatAgo(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}
