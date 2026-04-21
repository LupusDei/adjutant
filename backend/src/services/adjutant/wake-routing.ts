/**
 * Wake Routing — adj-163.2: Route stimulus engine wakes to the correct agent session.
 *
 * Extracted from the onWake callback in index.ts for testability.
 * The coordinator path (rich situation prompt) remains unchanged.
 * Non-coordinator paths receive a simple [SCHEDULED REMINDER] message.
 *
 * Auto-disables schedules when:
 * - Target session is dead (not found in registry)
 * - Delivery fails (sendInput returns false or throws)
 */

import { logInfo } from "../../utils/index.js";
import type { WakeReason } from "./stimulus-engine.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Dependencies injected into the routing function.
 * Keeps the function unit-testable without importing heavy singletons.
 */
export interface WakeRoutingDeps {
  /** The coordinator's tmux session name (e.g. "adjutant-coordinator") */
  coordinatorTmuxSession: string;
  /** Look up a session by tmux session name — returns undefined/null if dead */
  findByTmuxSession: (tmuxSession: string) => { id: string } | null | undefined;
  /** Send text input to a session by session ID — resolves to success boolean */
  sendInput: (sessionId: string, text: string) => Promise<boolean>;
  /** Disable a recurring schedule by ID */
  disableSchedule: (scheduleId: string) => void;
  /** Build the full coordinator situation prompt */
  buildCoordinatorPrompt: (reason: WakeReason) => string;
  /** Called after successful coordinator prompt delivery (markNudgeSent, logDecision, etc.) */
  onCoordinatorSuccess: (reason: WakeReason) => void;
}

// ============================================================================
// Main routing function
// ============================================================================

/**
 * Route a wake to the correct agent session.
 *
 * - If targetTmuxSession is set and differs from coordinator, sends a simple reminder.
 * - Otherwise, sends the full situation prompt to the coordinator.
 * - Auto-disables schedules on dead sessions or delivery failures.
 */
export async function handleWakeRouting(
  reason: WakeReason,
  deps: WakeRoutingDeps,
): Promise<void> {
  const targetTmux = reason.targetTmuxSession ?? deps.coordinatorTmuxSession;
  const isCoordinator = targetTmux === deps.coordinatorTmuxSession;

  // Look up the target session
  const session = deps.findByTmuxSession(targetTmux);

  if (!session) {
    // Dead session — disable schedule if this is a recurring schedule
    if (reason.scheduleId) {
      deps.disableSchedule(reason.scheduleId);
      logInfo("Schedule auto-disabled — target session dead", {
        scheduleId: reason.scheduleId,
        target: targetTmux,
      });
    }
    return;
  }

  // Build the prompt based on target type
  let prompt: string;
  if (isCoordinator) {
    prompt = deps.buildCoordinatorPrompt(reason);
  } else {
    prompt = `[SCHEDULED REMINDER] ${reason.reason ?? reason.type}`;
  }

  // Deliver the prompt
  let success = false;
  try {
    success = await deps.sendInput(session.id, prompt);
  } catch {
    // Delivery threw — treat as failure
    logInfo("Wake delivery error", { target: targetTmux, reason: reason.type });
  }

  if (success) {
    if (isCoordinator) {
      deps.onCoordinatorSuccess(reason);
    }
  } else {
    // Delivery failed — disable schedule if present
    if (reason.scheduleId) {
      deps.disableSchedule(reason.scheduleId);
      logInfo("Schedule auto-disabled — delivery failed", {
        scheduleId: reason.scheduleId,
        target: targetTmux,
      });
    }
    if (isCoordinator) {
      logInfo("StimulusEngine: prompt injection failed", { reason: reason.type });
    }
  }
}
