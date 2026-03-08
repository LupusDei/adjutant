/**
 * Adjutant Core — event-driven dispatch engine.
 *
 * Subscribes to the EventBus via onAny() and dispatches matching events
 * to registered behaviors. Scheduled behaviors run via node-cron.
 *
 * Usage:
 *   initAdjutantCore({ registry, state, comm })
 *   // ... later ...
 *   stopAdjutantCore()
 */

import cron from "node-cron";
import type { ScheduledTask } from "node-cron";

import { getEventBus, type EventName } from "../event-bus.js";
import type { BehaviorRegistry, BehaviorEvent, AdjutantBehavior } from "./behavior-registry.js";
import type { AdjutantState } from "./state-store.js";
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
let cronTasks: ScheduledTask[] = [];

// ============================================================================
// Event Dispatch
// ============================================================================

function dispatchEvent(
  event: BehaviorEvent,
  behaviors: AdjutantBehavior[],
  state: AdjutantState,
  comm: CommunicationManager,
): void {
  for (const behavior of behaviors) {
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
 * Subscribes to EventBus via onAny() and registers cron jobs for
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

  // Register cron jobs for scheduled behaviors
  const scheduled = registry.getScheduledBehaviors();
  for (const behavior of scheduled) {
    const task = cron.schedule(behavior.schedule!, () => {
      const cronEvent: BehaviorEvent = {
        name: (behavior.triggers[0] ?? "agent:status_changed") as EventName,
        data: { cronTick: true, behavior: behavior.name },
        seq: 0,
      };
      dispatchEvent(cronEvent, [behavior], state, comm);
    });
    cronTasks.push(task);
    logInfo(`AdjutantCore: Cron registered for "${behavior.name}"`, {
      schedule: behavior.schedule,
    });
  }

  initialized = true;
  logInfo("AdjutantCore initialized", {
    behaviors: registry.getAll().length,
    scheduled: scheduled.length,
  });
}

/**
 * Stop the Adjutant Core.
 *
 * Unsubscribes from EventBus and stops all cron jobs.
 * Safe to call without init.
 */
export function stopAdjutantCore(): void {
  if (eventHandler) {
    getEventBus().offAny(eventHandler);
    eventHandler = null;
  }

  for (const task of cronTasks) {
    task.stop();
  }
  cronTasks = [];

  initialized = false;
}
