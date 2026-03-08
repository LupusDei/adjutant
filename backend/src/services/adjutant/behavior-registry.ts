import type { EventName } from "../event-bus.js";
import type { AdjutantState } from "./state-store.js";
import type { CommunicationManager } from "./communication.js";

/**
 * Event payload as seen by behaviors.
 * The raw EventBus payload plus the event name.
 */
export interface BehaviorEvent {
  name: EventName;
  data: unknown;
  seq: number;
}

/**
 * A pluggable behavior module for the Adjutant system.
 *
 * Behaviors declare:
 * - `triggers`: EventBus events that activate this behavior
 * - `schedule`: optional cron expression for periodic execution
 * - `shouldAct`: fast synchronous guard — returns false to skip
 * - `act`: async handler that performs the behavior's action
 *
 * AdjutantState and CommunicationManager are injected by the core.
 */
export interface AdjutantBehavior {
  /** Unique name for logging and decision tracking */
  name: string;
  /** EventBus events that trigger this behavior */
  triggers: EventName[];
  /** Optional cron expression for periodic behaviors (e.g., "0 * * * *") */
  schedule?: string;
  /** Fast synchronous guard — return false to skip act() */
  shouldAct(event: BehaviorEvent, state: AdjutantState): boolean;
  /** Async handler that performs the behavior's action */
  act(event: BehaviorEvent, state: AdjutantState, comm: CommunicationManager): Promise<void>;
}

/**
 * Registry for Adjutant behaviors.
 * Stores behaviors and provides lookup by event name and schedule.
 */
export class BehaviorRegistry {
  private behaviors: AdjutantBehavior[] = [];

  /** Register a behavior. Throws if a behavior with the same name already exists. */
  register(behavior: AdjutantBehavior): void {
    if (this.behaviors.some((b) => b.name === behavior.name)) {
      throw new Error(
        `Behavior "${behavior.name}" is already registered`,
      );
    }
    this.behaviors.push(behavior);
  }

  /** Get all behaviors that should fire for a given event name */
  getBehaviorsForEvent(eventName: EventName): AdjutantBehavior[] {
    return this.behaviors.filter((b) => b.triggers.includes(eventName));
  }

  /** Get all behaviors that have a cron schedule */
  getScheduledBehaviors(): AdjutantBehavior[] {
    return this.behaviors.filter((b) => b.schedule != null && b.schedule !== "");
  }

  /** Get all registered behaviors (returns a copy) */
  getAll(): AdjutantBehavior[] {
    return [...this.behaviors];
  }

  /** Get a behavior by name */
  getByName(name: string): AdjutantBehavior | undefined {
    return this.behaviors.find((b) => b.name === name);
  }
}
