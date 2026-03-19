import type { AdjutantBehavior, BehaviorEvent } from "../behavior-registry.js";
import type { AdjutantState } from "../state-store.js";
import type { CommunicationManager } from "../communication.js";
import type { MemoryStore } from "../memory-store.js";
import type { BeadClosedEvent } from "../../event-bus.js";

// ============================================================================
// Memory Collector Behavior
// ============================================================================

/**
 * Create the memory-collector behavior.
 *
 * This behavior listens for:
 * - mail:received (from user): detects corrections using regex patterns
 * - bead:closed: captures bead outcomes for learning
 * - agent:status_changed: tracks agent failure patterns
 *
 * Uses closure to capture the MemoryStore dependency.
 */
export function createMemoryCollector(memoryStore: MemoryStore): AdjutantBehavior {
  return {
    name: "memory-collector",
    triggers: ["bead:closed", "agent:status_changed"],

    shouldAct(_event: BehaviorEvent, _state: AdjutantState): boolean {
      return true;
    },

    async act(event: BehaviorEvent, state: AdjutantState, _comm: CommunicationManager): Promise<void> {
      switch (event.name) {
        case "bead:closed":
          handleBeadClosed(event, state, memoryStore);
          break;
        case "agent:status_changed":
          // Handled in adj-053.2.2 (bead outcome capture)
          break;
      }
    },
  };
}

/**
 * Handle bead:closed events to capture outcomes.
 *
 * Detects failure patterns by checking the decisions log:
 * - Bead reopened: decisions with action "bead_reopened" targeting this bead
 * - Multiple assignments: 3+ "assign" decisions targeting this bead
 */
function handleBeadClosed(
  event: BehaviorEvent,
  state: AdjutantState,
  memoryStore: MemoryStore,
): void {
  const data = event.data as BeadClosedEvent;

  // Log the closure
  state.logDecision({
    behavior: "memory-collector",
    action: "bead_outcome_noted",
    target: data.id,
    reason: `Bead "${data.title}" closed at ${data.closedAt}`,
  });

  // Check decisions log for failure patterns
  const recentDecisions = state.getRecentDecisions(200);
  const beadDecisions = recentDecisions.filter((d) => d.target === data.id);

  // Check 1: Was this bead reopened?
  const wasReopened = beadDecisions.some((d) => d.action === "bead_reopened");

  // Check 2: Multiple assignments (3+ assigns = trouble)
  const assignCount = beadDecisions.filter((d) => d.action === "assign").length;
  const hadMultipleAssignments = assignCount >= 3;

  if (wasReopened) {
    memoryStore.insertLearning({
      category: "operational",
      topic: "bead-quality",
      content: `Bead ${data.id} ("${data.title}") was reopened after initial closure — indicates incomplete or incorrect work on first attempt.`,
      sourceType: "bead_outcome",
      sourceRef: data.id,
      confidence: 0.6,
    });

    state.logDecision({
      behavior: "memory-collector",
      action: "failure_pattern_detected",
      target: data.id,
      reason: "Bead was reopened — created learning about reopened bead pattern",
    });
  }

  if (hadMultipleAssignments) {
    memoryStore.insertLearning({
      category: "operational",
      topic: "bead-assignment",
      content: `Bead ${data.id} ("${data.title}") required multiple reassignments (${assignCount} assignments) — indicates task difficulty or agent capability mismatch.`,
      sourceType: "bead_outcome",
      sourceRef: data.id,
      confidence: 0.5,
    });

    state.logDecision({
      behavior: "memory-collector",
      action: "failure_pattern_detected",
      target: data.id,
      reason: `Bead had ${assignCount} assignments — created learning about multiple reassignment pattern`,
    });
  }
}
