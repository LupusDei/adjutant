import type { AdjutantBehavior, BehaviorEvent } from "../behavior-registry.js";
import type { AdjutantState } from "../state-store.js";
import type { CommunicationManager } from "../communication.js";
import type { EventName, BeadClosedEvent } from "../../event-bus.js";

/** Number of recent decisions to scan for build status */
const DECISION_LOOKBACK = 50;

/** Reasons that bypass quality gate checks */
const SKIP_REASONS = new Set(["by-design", "deferred", "duplicate", "wontfix"]);

/**
 * Creates a quality-gate behavior.
 *
 * Triggers on bead:closed events. For task/bug beads, verifies the last build
 * for the assigned agent passed. If not, logs a gate failure and notifies the
 * user and assignee.
 *
 * Skips: epics, beads with no assignee, beads closed with skip reasons.
 */
export function createQualityGateBehavior(): AdjutantBehavior {
  return {
    name: "quality-gate",
    triggers: ["bead:closed"] as EventName[],

    shouldAct(event: BehaviorEvent, _state: AdjutantState): boolean {
      const data = event.data as BeadClosedEvent;

      // Skip epics — they auto-close and don't represent direct work
      if (data.type === "epic") return false;

      // Skip beads with skip reasons
      if (data.reason && SKIP_REASONS.has(data.reason.toLowerCase())) return false;

      // Skip beads with no assignee — can't check build status without one
      if (!data.assignee) return false;

      return true;
    },

    async act(
      event: BehaviorEvent,
      state: AdjutantState,
      comm: CommunicationManager,
    ): Promise<void> {
      if (event.name !== "bead:closed") return;

      const data = event.data as BeadClosedEvent;
      const beadId = data.id;
      const assignee = data.assignee;
      if (!assignee) return;

      const buildStatus = checkLastBuildStatus(assignee, state);

      if (buildStatus === "failed") {
        state.logDecision({
          behavior: "quality-gate",
          action: "gate_failed",
          target: beadId,
          reason: "last build for assignee failed",
        });

        await comm.sendImportant(
          `Quality gate failed for bead ${beadId} ("${data.title}"): last build for agent "${assignee}" failed. Bead may need to be reopened.`,
        );

        await comm.messageAgent(
          assignee,
          `Bead ${beadId} was closed but the quality gate detected your last build failed. Please verify the build passes and reopen the bead if needed.`,
        );
      } else {
        // "passed" or "unknown" (no build data = no block)
        state.logDecision({
          behavior: "quality-gate",
          action: "gate_passed",
          target: beadId,
          reason: "build verification passed",
        });

        comm.queueRoutine(
          `Quality gate passed for bead ${beadId} ("${data.title}")`,
        );
      }
    },
  };
}

/**
 * Checks the most recent build decision for the given agent.
 * Returns "passed", "failed", or "unknown" (no data).
 */
function checkLastBuildStatus(
  agentId: string,
  state: AdjutantState,
): "passed" | "failed" | "unknown" {
  const decisions = state.getRecentDecisions(DECISION_LOOKBACK);

  // Find the most recent build decision for this agent
  const buildDecision = decisions.find(
    (d) =>
      d.behavior === "build-monitor" &&
      (d.action === "build_passed" || d.action === "build_failed") &&
      d.target === agentId,
  );

  if (!buildDecision) return "unknown";

  return buildDecision.action === "build_passed" ? "passed" : "failed";
}
