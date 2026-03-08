import type { AdjutantBehavior, BehaviorEvent } from "../behavior-registry.js";
import type { AdjutantState, AgentProfile } from "../state-store.js";
import type { CommunicationManager } from "../communication.js";

/** Agents with no status update for this long are considered stale */
const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

/** Don't nudge the same agent more than once in this window */
const NUDGE_DEBOUNCE_MS = 60 * 60 * 1000; // 1 hour

export function createStaleAgentNudger(): AdjutantBehavior {
  /** Track when each agent was last nudged: agentId -> timestamp */
  const lastNudged = new Map<string, number>();

  function isStale(profile: AgentProfile): boolean {
    // Don't nudge disconnected or unknown agents
    if (profile.lastStatus === "disconnected" || profile.lastStatus === "unknown") {
      return false;
    }
    // Don't nudge idle/done agents — they're intentionally inactive
    if (profile.lastStatus === "idle" || profile.lastStatus === "done") {
      return false;
    }
    const lastUpdate = new Date(profile.lastStatusAt).getTime();
    return Date.now() - lastUpdate > STALE_THRESHOLD_MS;
  }

  function shouldNudge(agentId: string): boolean {
    const last = lastNudged.get(agentId);
    if (last === undefined) return true;
    return Date.now() - last > NUDGE_DEBOUNCE_MS;
  }

  return {
    name: "stale-agent-nudger",
    triggers: ["agent:status_changed"],
    schedule: "*/15 * * * *",

    shouldAct(_event: BehaviorEvent, _state: unknown): boolean {
      return true;
    },

    async act(_event: BehaviorEvent, state: unknown, comm: unknown): Promise<void> {
      const adjState = state as AdjutantState;
      const adjComm = comm as CommunicationManager;

      const profiles = adjState.getAllAgentProfiles();
      const staleAgents: string[] = [];

      for (const profile of profiles) {
        if (!isStale(profile)) continue;
        if (!shouldNudge(profile.agentId)) continue;

        // Send nudge
        await adjComm.messageAgent(
          profile.agentId,
          "Status check: you haven't reported activity in over an hour. Please update your status or report a blocker.",
        );

        lastNudged.set(profile.agentId, Date.now());
        staleAgents.push(profile.agentId);

        adjState.logDecision({
          behavior: "stale-agent-nudger",
          action: "nudge_sent",
          target: profile.agentId,
          reason: `Last status update: ${profile.lastStatusAt}`,
        });
      }

      if (staleAgents.length > 0) {
        adjComm.queueRoutine(
          `Nudged ${staleAgents.length} stale agent(s): ${staleAgents.join(", ")}`,
        );
      }
    },
  };
}
