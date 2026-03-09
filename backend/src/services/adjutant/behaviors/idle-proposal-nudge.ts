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

/** Maximum number of pending proposals before new creation is blocked */
const PENDING_CAP = 12;

/**
 * Build the reason string for scheduleCheck.
 * Contains idle agent ID and proposal context for the coordinator.
 * The coordinator reads this as its situation prompt and decides how to nudge.
 */
function buildScheduleReason(agentId: string, proposalStore: ProposalStore): string {
  const pending = proposalStore.getProposals({ status: "pending" });
  const dismissed = proposalStore.getProposals({ status: "dismissed" });

  const parts: string[] = [];
  parts.push(`Agent "${agentId}" has been idle for 5 minutes.`);

  if (pending.length === 0 && dismissed.length === 0) {
    parts.push("No existing proposals — agent can create new proposals freely.");
  } else {
    if (pending.length > 0) {
      parts.push(`Pending proposals (${pending.length}):`);
      for (const p of pending) {
        parts.push(`  - [${p.id}] ${p.title}`);
      }
    }
    if (dismissed.length > 0) {
      parts.push(`Dismissed proposals (${dismissed.length}):`);
      for (const p of dismissed) {
        parts.push(`  - [${p.id}] ${p.title}`);
      }
    }

    // Pending cap check
    if (pending.length >= PENDING_CAP) {
      parts.push(
        `PENDING CAP REACHED (${pending.length}/${PENDING_CAP}) — agent must improve an existing proposal, not create new ones.`,
      );
    }
  }

  parts.push("Consider nudging them to work on proposals.");
  return parts.join("\n");
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
      // Must return true for ALL agent:status_changed events (not just idle)
      // because act() needs to clear debounce keys on non-idle transitions.
      return event.name === "agent:status_changed";
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
