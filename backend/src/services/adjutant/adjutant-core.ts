/**
 * Adjutant Core — event-driven dispatch engine.
 *
 * Subscribes to the EventBus via onAny() and dispatches matching events
 * to registered behaviors. Scheduled behaviors run via setInterval.
 *
 * Usage:
 *   initAdjutantCore({ registry, state, comm })
 *   // ... later ...
 *   stopAdjutantCore()
 */

import { getEventBus, type EventName } from "../event-bus.js";
import type { BehaviorRegistry, BehaviorEvent, AdjutantBehavior } from "./behavior-registry.js";
import type { AdjutantState } from "./state-store.js";
import type { AgentRole } from "./state-store.js";
import type { CommunicationManager } from "./communication.js";
import { logInfo, logWarn } from "../../utils/index.js";

// ============================================================================
// Types
// ============================================================================

export interface AdjutantCoreDeps {
  registry: BehaviorRegistry;
  state: AdjutantState;
  comm: CommunicationManager;
}

// ============================================================================
// State
// ============================================================================

let initialized = false;
let eventHandler: ((event: EventName, data: unknown, seq: number) => void) | null = null;
let intervalTimers: ReturnType<typeof setInterval>[] = [];

// ============================================================================
// Cron-to-Interval
// ============================================================================

/**
 * Convert simple cron expressions to millisecond intervals.
 *
 * Supported patterns:
 *   "* /N * * * *"  → every N minutes  (written without space — escaped here for comment)
 *   "0 * * * *"     → every 60 minutes (top of each hour)
 *   "0 * /N * * *"  → every N hours  (written without space — escaped here for comment)
 *   "0 H * * *"     → once per day (24-hour interval)
 *   "0 0 * * D"     → weekly (7-day interval)
 *   "0 0 D * *"     → ~monthly (30-day interval)
 *
 * Throws on monthly+ (non-wildcard month) patterns.
 */
export function cronToIntervalMs(schedule: string): number {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Unsupported cron expression (expected 5 fields): "${schedule}"`);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Month must always be wildcard
  if (month !== "*") {
    throw new Error(`Unsupported cron expression (monthly+ intervals not supported): "${schedule}"`);
  }

  // Weekly schedule: specific dayOfWeek (e.g., "0 0 * * 1" = Monday midnight)
  if (dayOfWeek !== "*") {
    return 7 * 24 * 60 * 60 * 1000;
  }

  // Daily schedule with specific dayOfMonth (e.g., "0 0 1 * *")
  if (dayOfMonth !== "*") {
    return 30 * 24 * 60 * 60 * 1000; // ~monthly approximation
  }

  // Hour-level schedules: minute must be a fixed number, hour is specific or stepped
  if (hour !== "*") {
    // "0 */N * * *" → every N hours
    const hourStep = hour!.match(/^\*\/(\d+)$/);
    if (hourStep) {
      const hours = parseInt(hourStep[1]!, 10);
      if (hours <= 0) {
        throw new Error(`Invalid hour step value in cron expression: "${schedule}"`);
      }
      return hours * 60 * 60 * 1000;
    }

    // "0 H * * *" → specific hour = once per day (24h interval)
    const fixedHour = parseInt(hour!, 10);
    if (!isNaN(fixedHour) && fixedHour >= 0 && fixedHour <= 23) {
      return 24 * 60 * 60 * 1000;
    }

    throw new Error(`Unsupported cron hour field "${hour}" in: "${schedule}"`);
  }

  // Minute-level schedules (hour is "*")

  // "*/N" → every N minutes
  const stepMatch = minute!.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    const minutes = parseInt(stepMatch[1]!, 10);
    if (minutes <= 0) {
      throw new Error(`Invalid step value in cron expression: "${schedule}"`);
    }
    return minutes * 60 * 1000;
  }

  // "0" → every 60 minutes (top of hour)
  if (minute === "0") {
    return 60 * 60 * 1000;
  }

  throw new Error(`Unsupported cron minute field "${minute}" in: "${schedule}"`);
}

// ============================================================================
// Event Dispatch
// ============================================================================

/**
 * Extract the agent ID from event data.
 * Events use different field names: `agent` (status events), `agentId` (MCP events).
 * Returns null if no agent ID can be found.
 */
function extractAgentId(data: unknown): string | null {
  if (data == null || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (typeof record["agentId"] === "string") return record["agentId"];
  if (typeof record["agent"] === "string") return record["agent"];
  return null;
}

/**
 * Check whether a behavior should be skipped due to excludeRoles filtering.
 * Returns true if the behavior should be skipped.
 */
function shouldExcludeByRole(
  behavior: AdjutantBehavior,
  event: BehaviorEvent,
  state: AdjutantState,
): boolean {
  if (!behavior.excludeRoles || behavior.excludeRoles.length === 0) {
    return false;
  }

  const agentId = extractAgentId(event.data);
  if (agentId === null) {
    // No agent ID in event data — don't filter, let the behavior run
    return false;
  }

  const profile = state.getAgentProfile(agentId);
  const role: AgentRole = profile?.role ?? "worker";

  return behavior.excludeRoles.includes(role);
}

function dispatchEvent(
  event: BehaviorEvent,
  behaviors: AdjutantBehavior[],
  state: AdjutantState,
  comm: CommunicationManager,
): void {
  for (const behavior of behaviors) {
    // Check excludeRoles guard before shouldAct
    if (shouldExcludeByRole(behavior, event, state)) {
      continue;
    }

    try {
      if (!behavior.shouldAct(event, state)) {
        continue;
      }
    } catch (err) {
      logWarn(`Behavior "${behavior.name}" shouldAct threw`, { error: String(err) });
      continue;
    }

    behavior.act(event, state, comm).catch((err: unknown) => {
      logWarn(`Behavior "${behavior.name}" act() failed`, { error: String(err) });
    });
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the Adjutant Core.
 *
 * Subscribes to EventBus via onAny() and registers interval timers for
 * scheduled behaviors. Idempotent — second call is a no-op.
 */
export function initAdjutantCore(deps: AdjutantCoreDeps): void {
  if (initialized) {
    return;
  }

  const { registry, state, comm } = deps;

  // Subscribe to all EventBus events
  eventHandler = (event: EventName, data: unknown, seq: number) => {
    const behaviorEvent: BehaviorEvent = { name: event, data, seq };
    const matching = registry.getBehaviorsForEvent(event);
    if (matching.length > 0) {
      dispatchEvent(behaviorEvent, matching, state, comm);
    }
  };

  getEventBus().onAny(eventHandler);
  logInfo("AdjutantCore: EventBus subscription active");

  // Register interval timers for scheduled behaviors
  const scheduled = registry.getScheduledBehaviors();
  for (const behavior of scheduled) {
    const intervalMs = cronToIntervalMs(behavior.schedule!);
    const timer = setInterval(() => {
      const cronEvent: BehaviorEvent = {
        name: (behavior.triggers[0] ?? "agent:status_changed") as EventName,
        data: { cronTick: true, behavior: behavior.name },
        seq: 0,
      };
      dispatchEvent(cronEvent, [behavior], state, comm);
    }, intervalMs);
    intervalTimers.push(timer);
    logInfo(`AdjutantCore: Interval registered for "${behavior.name}"`, {
      schedule: behavior.schedule,
      intervalMs,
    });
  }

  // Fire all scheduled behaviors once after a 60-second startup delay
  // so the user doesn't wait a full interval for the first report.
  const STARTUP_DELAY_MS = 60_000;
  const startupTimer = setTimeout(() => {
    for (const behavior of scheduled) {
      const startupEvent: BehaviorEvent = {
        name: (behavior.triggers[0] ?? "agent:status_changed") as EventName,
        data: { cronTick: true, behavior: behavior.name, startup: true },
        seq: 0,
      };
      dispatchEvent(startupEvent, [behavior], state, comm);
    }
    logInfo("AdjutantCore: Startup fire completed for scheduled behaviors");
  }, STARTUP_DELAY_MS);
  intervalTimers.push(startupTimer as unknown as ReturnType<typeof setInterval>);

  initialized = true;
  logInfo("AdjutantCore initialized", {
    behaviors: registry.getAll().length,
    scheduled: scheduled.length,
  });
}

/**
 * Stop the Adjutant Core.
 *
 * Unsubscribes from EventBus and clears all interval timers.
 * Safe to call without init.
 */
export function stopAdjutantCore(): void {
  if (eventHandler) {
    getEventBus().offAny(eventHandler);
    eventHandler = null;
  }

  for (const timer of intervalTimers) {
    clearInterval(timer);
  }
  intervalTimers = [];

  initialized = false;
}
