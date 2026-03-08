import type { AdjutantBehavior, BehaviorEvent } from "../behavior-registry.js";
import type { AdjutantState } from "../state-store.js";
import type { CommunicationManager } from "../communication.js";
import type {
  EventName,
  BuildFailedEvent,
  BuildPassedEvent,
} from "../../event-bus.js";

/** Rate limit window: 10 minutes in milliseconds */
const RATE_LIMIT_MS = 10 * 60 * 1000;

/** Max error output length in notification messages */
const MAX_ERROR_LENGTH = 500;

/**
 * Creates a build-monitor behavior.
 *
 * Triggers on build:failed and build:passed events.
 * On failure: logs decision, notifies user (important), messages the failing agent.
 * On pass: logs decision, queues routine message, clears rate limit for agent.
 *
 * Guards:
 * - Rate limits to 1 failure notification per agent per 10 minutes
 * - Skips user notification for bug-fix bead streams (to avoid feedback loops)
 */
export function createBuildMonitorBehavior(): AdjutantBehavior {
  /** Tracks last failure notification time per agent for rate limiting */
  const lastNotifiedAt = new Map<string, number>();

  return {
    name: "build-monitor",
    triggers: ["build:failed", "build:passed"] as EventName[],

    shouldAct(_event: BehaviorEvent, _state: AdjutantState): boolean {
      return true;
    },

    async act(
      event: BehaviorEvent,
      state: AdjutantState,
      comm: CommunicationManager,
    ): Promise<void> {
      switch (event.name) {
        case "build:failed": {
          const data = event.data as BuildFailedEvent;
          await handleBuildFailed(data, state, comm, lastNotifiedAt);
          break;
        }

        case "build:passed": {
          const data = event.data as BuildPassedEvent;
          handleBuildPassed(data, state, comm, lastNotifiedAt);
          break;
        }
      }
    },
  };
}

async function handleBuildFailed(
  data: BuildFailedEvent,
  state: AdjutantState,
  comm: CommunicationManager,
  lastNotifiedAt: Map<string, number>,
): Promise<void> {
  state.logDecision({
    behavior: "build-monitor",
    action: "build_failed",
    target: data.agentId,
    reason: `exit code ${data.exitCode}`,
  });

  // Always message the failing agent so it knows about the failure
  await comm.messageAgent(
    data.agentId,
    `Your build failed (exit code ${data.exitCode}, stream ${data.streamId}). Check the error output and fix the issue.`,
  );

  // Check if this is a bug-fix bead stream — skip user notification to avoid loops
  const profile = state.getAgentProfile(data.agentId);
  if (profile?.currentTask && isBugFixTask(profile.currentTask)) {
    return;
  }

  // Rate limit: 1 notification per agent per 10 minutes
  const now = Date.now();
  const lastTime = lastNotifiedAt.get(data.agentId);
  if (lastTime != null && now - lastTime < RATE_LIMIT_MS) {
    return;
  }
  lastNotifiedAt.set(data.agentId, now);

  const truncatedError = data.errorOutput.length > MAX_ERROR_LENGTH
    ? data.errorOutput.slice(0, MAX_ERROR_LENGTH) + "…"
    : data.errorOutput;

  await comm.sendImportant(
    `Agent "${data.agentId}" build failed (exit code ${data.exitCode}):\n\`\`\`\n${truncatedError}\n\`\`\``,
  );
}

function handleBuildPassed(
  data: BuildPassedEvent,
  state: AdjutantState,
  comm: CommunicationManager,
  lastNotifiedAt: Map<string, number>,
): void {
  state.logDecision({
    behavior: "build-monitor",
    action: "build_passed",
    target: data.agentId,
    reason: null,
  });

  // Clear rate limit so next failure is immediately notified
  lastNotifiedAt.delete(data.agentId);

  comm.queueRoutine(`Agent "${data.agentId}" build passed (stream ${data.streamId})`);
}

/** Check if the agent's current task looks like a bug fix (to avoid notification loops) */
function isBugFixTask(task: string): boolean {
  const lower = task.toLowerCase();
  return lower.includes("fix") || lower.includes("bug");
}
