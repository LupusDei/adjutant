import type { AdjutantBehavior, BehaviorEvent } from "../behavior-registry.js";
import type { AdjutantState, AgentProfile } from "../state-store.js";
import type { CommunicationManager } from "../communication.js";
import { execBd } from "../../bd-client.js";

/** Agents idle for this long become decommission candidates */
const IDLE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/** Don't re-target the same agent within this window */
const DEBOUNCE_MS = 30 * 60 * 1000; // 30 minutes

/** Warning must be this old before escalating */
const WARNING_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

/** Agent IDs that must never be decommissioned (adj-07uz) */
const PROTECTED_AGENT_IDS = new Set(["adjutant-coordinator", "adjutant"]);

export function createAgentDecommissioner(): AdjutantBehavior {
  /** Track when each agent was last targeted: agentId -> timestamp */
  const lastDecommissionTarget = new Map<string, number>();

  /**
   * Check if an agent is a decommission candidate:
   * - Status is "idle" or "done"
   * - Still connected (disconnectedAt is null)
   * - Idle for 30+ minutes
   * - Not a protected agent
   */
  function isCandidate(profile: AgentProfile): boolean {
    if (PROTECTED_AGENT_IDS.has(profile.agentId)) return false;
    if (profile.lastStatus !== "idle" && profile.lastStatus !== "done") return false;
    if (profile.disconnectedAt !== null) return false;

    const lastUpdate = new Date(profile.lastStatusAt).getTime();
    return Date.now() - lastUpdate > IDLE_THRESHOLD_MS;
  }

  /** Check debounce: was this agent targeted within the last 30 min? */
  function isDebounced(agentId: string): boolean {
    const last = lastDecommissionTarget.get(agentId);
    if (last === undefined) return false;
    return Date.now() - last < DEBOUNCE_MS;
  }

  /** Check if agent has any in-progress beads */
  async function hasInProgressBeads(agentId: string): Promise<boolean> {
    try {
      const result = await execBd(
        ["list", "--status=in_progress", `--assignee=${agentId}`, "--json"],
      );
      if (result.success && Array.isArray(result.data) && result.data.length > 0) {
        return true;
      }
      return false;
    } catch {
      // On failure, assume no beads (let decommission proceed)
      return false;
    }
  }

  return {
    name: "agent-decommissioner",
    triggers: ["agent:status_changed"],
    schedule: "*/30 * * * *",

    shouldAct(_event: BehaviorEvent, _state: AdjutantState): boolean {
      // Always return true — let act() do the checking
      return true;
    },

    async act(_event: BehaviorEvent, state: AdjutantState, comm: CommunicationManager): Promise<void> {
      const profiles = state.getAllAgentProfiles();

      for (const profile of profiles) {
        if (!isCandidate(profile)) continue;
        if (isDebounced(profile.agentId)) continue;

        // Check if agent has in-progress beads
        const hasBead = await hasInProgressBeads(profile.agentId);
        if (hasBead) {
          state.logDecision({
            behavior: "agent-decommissioner",
            action: "skip_has_beads",
            target: profile.agentId,
            reason: "Agent has in-progress beads",
          });
          continue;
        }

        // Check if already warned
        const warningMeta = state.getMeta(`decommission-warned:${profile.agentId}`);
        const warningTimestamp = warningMeta ? parseInt(warningMeta, 10) : null;

        if (warningTimestamp && !isNaN(warningTimestamp)) {
          // Already warned — check if enough time has passed to escalate
          const timeSinceWarning = Date.now() - warningTimestamp;

          if (timeSinceWarning > WARNING_EXPIRY_MS) {
            // Escalate to user
            const idleMinutes = Math.round(
              (Date.now() - new Date(profile.lastStatusAt).getTime()) / (60 * 1000),
            );
            await comm.escalate(
              `Agent ${profile.agentId} has been idle for ${idleMinutes}+ minutes despite shutdown request. Consider manually terminating.`,
            );

            // Clear warning meta
            state.setMeta(`decommission-warned:${profile.agentId}`, "");

            // Mark spawn as decommissioned if applicable
            const lastSpawn = state.getLastSpawn(profile.agentId);
            if (lastSpawn && !lastSpawn.decommissionedAt) {
              state.markDecommissioned(lastSpawn.id);
            }

            // Update debounce
            lastDecommissionTarget.set(profile.agentId, Date.now());

            state.logDecision({
              behavior: "agent-decommissioner",
              action: "escalated_to_user",
              target: profile.agentId,
              reason: `Agent idle ${idleMinutes}+ minutes, warning sent ${Math.round(timeSinceWarning / (60 * 1000))} min ago`,
            });
          }
          // If not enough time since warning, skip (wait for next sweep)
        } else {
          // Not warned yet — send shutdown suggestion
          await comm.messageAgent(
            profile.agentId,
            `You have been idle for 30+ minutes with no pending work. Consider shutting down to free resources. If you still have work to do, please update your status.`,
          );

          // Set warning meta
          state.setMeta(
            `decommission-warned:${profile.agentId}`,
            Date.now().toString(),
          );

          // Update debounce
          lastDecommissionTarget.set(profile.agentId, Date.now());

          state.logDecision({
            behavior: "agent-decommissioner",
            action: "shutdown_suggested",
            target: profile.agentId,
            reason: `Last status update: ${profile.lastStatusAt}`,
          });
        }
      }
    },
  };
}
