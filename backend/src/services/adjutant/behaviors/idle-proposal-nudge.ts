import type { AdjutantBehavior, BehaviorEvent } from "../behavior-registry.js";
import type { AdjutantState } from "../state-store.js";
import type { CommunicationManager } from "../communication.js";
import type { StimulusEngine } from "../stimulus-engine.js";
import type { ProposalStore } from "../../proposal-store.js";
import type { AgentStatusEvent } from "../../event-bus.js";

/** Delay before waking the coordinator: 5 minutes */
const IDLE_CHECK_DELAY_MS = 300_000;

/** Metadata key prefix for per-agent debounce (stores check ID) */
const DEBOUNCE_META_PREFIX = "idle_nudge_check_";

/**
 * Build the reason string for scheduleCheck.
 * Contains idle agent ID and proposal context for the coordinator.
 *
 * Phase 1 (adj-057.1.2): basic reason with agent ID.
 * Phase 2 (adj-057.1.4): adds proposal summaries.
 * Phase 3 (adj-057.1.6): adds pending cap status.
 */
function buildScheduleReason(agentId: string, _proposalStore: ProposalStore): string {
  // Minimal implementation — proposal context added in adj-057.1.4
  return `Agent "${agentId}" has been idle for 5 minutes. Consider nudging them to work on proposals.`;
}

/**
 * Create the idle-proposal-nudge behavior.
 *
 * When an agent goes idle, this behavior schedules a delayed coordinator wake
 * via stimulusEngine.scheduleCheck() with context about existing proposals.
 * The behavior never messages agents directly — only the coordinator does that.
 */
export function createIdleProposalNudge(
  stimulusEngine: StimulusEngine,
  proposalStore: ProposalStore,
): AdjutantBehavior {
  return {
    name: "idle-proposal-nudge",
    triggers: ["agent:status_changed"],

    shouldAct(event: BehaviorEvent, _state: AdjutantState): boolean {
      if (event.name !== "agent:status_changed") return false;
      const data = event.data as AgentStatusEvent;
      return data.status === "idle";
    },

    async act(event: BehaviorEvent, state: AdjutantState, _comm: CommunicationManager): Promise<void> {
      const data = event.data as AgentStatusEvent;
      const agentId = data.agent;

      // If agent transitions to non-idle, clear debounce so next idle can trigger
      if (data.status !== "idle") {
        state.setMeta(`${DEBOUNCE_META_PREFIX}${agentId}`, "");
        return;
      }

      // Skip disconnected agents
      const profile = state.getAgentProfile(agentId);
      if (!profile) return;
      if (profile.disconnectedAt !== null) return;

      // Debounce: skip if we already have a pending check for this agent
      const existingCheckId = state.getMeta(`${DEBOUNCE_META_PREFIX}${agentId}`);
      if (existingCheckId) return;

      // Build reason string with proposal context
      const reason = buildScheduleReason(agentId, proposalStore);

      // Schedule the coordinator wake
      const checkId = stimulusEngine.scheduleCheck(IDLE_CHECK_DELAY_MS, reason);

      // Store check ID for debounce
      state.setMeta(`${DEBOUNCE_META_PREFIX}${agentId}`, checkId);

      // Log the decision for audit trail
      state.logDecision({
        behavior: "idle-proposal-nudge",
        action: "scheduled_idle_check",
        target: agentId,
        reason,
      });
    },
  };
}
