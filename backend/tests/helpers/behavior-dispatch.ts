/**
 * Test helper that replicates the shouldAct → act dispatch flow
 * from adjutant-core.ts dispatchEvent().
 *
 * Use this instead of calling behavior.act() directly in tests
 * to ensure shouldAct() filtering is exercised — matching production behavior.
 *
 * @see adjutant-core.ts dispatchEvent() (the canonical implementation)
 */

import type { AdjutantBehavior, BehaviorEvent } from "../../src/services/adjutant/behavior-registry.js";
import type { AdjutantState } from "../../src/services/adjutant/state-store.js";
import type { CommunicationManager } from "../../src/services/adjutant/communication.js";

/**
 * Dispatch an event to a behavior through the shouldAct → act flow.
 * Returns whether act() was called (i.e., shouldAct returned true).
 */
export async function dispatchToBehavior(
  behavior: AdjutantBehavior,
  event: BehaviorEvent,
  state: AdjutantState,
  comm: CommunicationManager,
): Promise<boolean> {
  if (!behavior.shouldAct(event, state)) {
    return false;
  }
  await behavior.act(event, state, comm);
  return true;
}
