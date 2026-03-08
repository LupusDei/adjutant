import type { AdjutantBehavior, BehaviorEvent } from "../behavior-registry.js";
import type { AdjutantState, AgentProfile } from "../state-store.js";
import type { CommunicationManager } from "../communication.js";
import { execBd } from "../../bd-client.js";
import { updateBead } from "../../beads/beads-mutations.js";
import { getEventBus } from "../../event-bus.js";
import { getConnectedAgents } from "../../mcp-server.js";

/** Debounce window: don't re-assign within 30 seconds of the last assignment */
const DEBOUNCE_MS = 30_000;

/** Agent IDs excluded from work assignment (coordinator/monitor roles). adj-spyk fix. */
const EXCLUDED_AGENT_IDS = new Set(["adjutant-coordinator"]);

/** Shape of a bead returned by `bd ready --json` */
interface ReadyBead {
  id: string;
  title: string;
  priority: number;
  type: string;
  parent?: string;
}

/**
 * Returns true if the agent is truly idle and connected (not a ghost/stale profile).
 * Cross-references the live MCP connections to prevent assigning to dead agents
 * whose profile wasn't properly updated (e.g., after a server restart).
 */
function isTrulyIdle(profile: AgentProfile, liveAgentIds: Set<string>): boolean {
  return (
    profile.lastStatus === "idle" &&
    profile.connectedAt !== null &&
    profile.disconnectedAt === null &&
    liveAgentIds.has(profile.agentId) &&
    !EXCLUDED_AGENT_IDS.has(profile.agentId)
  );
}

/**
 * Extracts the parent epic ID from a bead, if present.
 * Beads from `bd ready` may include a `parent` field.
 */
function getParentEpic(bead: ReadyBead): string | null {
  return bead.parent ?? null;
}

/**
 * Finds the best agent to assign to a bead, based on:
 * 1. Epic affinity: prefer agents whose lastEpicId matches the bead's parent epic
 * 2. Tiebreaker: prefer agents that became idle most recently (lastActivity DESC)
 */
function findBestAgent(idleAgents: AgentProfile[], bead: ReadyBead): AgentProfile | null {
  if (idleAgents.length === 0) return null;

  const parentEpic = getParentEpic(bead);

  // Sort: agents with matching epic affinity first, then by most recent activity
  const sorted = [...idleAgents].sort((a, b) => {
    // Epic affinity: agents matching the bead's parent epic come first
    if (parentEpic) {
      const aMatch = a.lastEpicId === parentEpic ? 0 : 1;
      const bMatch = b.lastEpicId === parentEpic ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
    }

    // Tiebreaker: most recently active agent first
    const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
    const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
    return bTime - aTime; // DESC
  });

  return sorted[0] ?? null;
}

export function createWorkAssigner(): AdjutantBehavior {
  /** Concurrency guard (adj-0074 fix) */
  let assigning = false;

  return {
    name: "work-assigner",
    triggers: ["bead:created", "agent:status_changed", "bead:closed"],
    schedule: "*/5 * * * *",

    shouldAct(_event: BehaviorEvent, state: AdjutantState): boolean {
      // Debounce check: skip if we assigned recently
      const lastAssigned = state.getMeta("work-assigner:last-assigned-at");
      if (lastAssigned) {
        const elapsed = Date.now() - new Date(lastAssigned).getTime();
        if (elapsed < DEBOUNCE_MS) return false;
      }

      // Check if at least one truly idle (connected, not ghost) agent exists
      const liveAgentIds = new Set(getConnectedAgents().map((a) => a.agentId));
      const profiles = state.getAllAgentProfiles();
      const hasIdleAgent = profiles.some((p) => isTrulyIdle(p, liveAgentIds));
      return hasIdleAgent;
    },

    async act(_event: BehaviorEvent, state: AdjutantState, _comm: CommunicationManager): Promise<void> {
      // Concurrency guard: prevent double-assignment
      if (assigning) return;
      assigning = true;

      try {
        // 1. Get all agent profiles and filter to truly idle agents
        const liveAgentIds = new Set(getConnectedAgents().map((a) => a.agentId));
        const profiles = state.getAllAgentProfiles();
        const idleAgents = profiles.filter((p) => isTrulyIdle(p, liveAgentIds));

        if (idleAgents.length === 0) return;

        // 2. Get ready (unblocked, unassigned) beads via `bd ready --json`
        const result = await execBd<ReadyBead[]>(["ready", "--json"]);

        if (!result.success || !result.data || result.data.length === 0) return;

        const readyBeads = result.data;

        // 3. Sort beads by priority (P0 first = lowest number first)
        readyBeads.sort((a, b) => a.priority - b.priority);

        // 4. Assign agents to beads: one agent per bead, highest priority first
        const assignedAgentIds = new Set<string>();

        for (const bead of readyBeads) {
          // Filter out agents that have already been assigned in this cycle
          const availableAgents = idleAgents.filter(
            (a) => !assignedAgentIds.has(a.agentId),
          );

          if (availableAgents.length === 0) break;

          const bestAgent = findBestAgent(availableAgents, bead);
          if (!bestAgent) break;

          // 5. Assign via updateBead (not raw execBd) so events are emitted properly
          const updateResult = await updateBead(bead.id, {
            status: "in_progress",
            assignee: bestAgent.agentId,
          });

          if (!updateResult.success) continue;

          assignedAgentIds.add(bestAgent.agentId);

          // 6. Emit bead:assigned event
          getEventBus().emit("bead:assigned", {
            beadId: bead.id,
            agentId: bestAgent.agentId,
            assignedBy: "work-assigner",
          });

          // 7. Update debounce meta
          state.setMeta("work-assigner:last-assigned-at", new Date().toISOString());

          // 8. Increment assignment count
          state.incrementAssignmentCount(bestAgent.agentId);

          // 9. Update lastEpicId on agent profile if bead has a parent epic
          const parentEpic = getParentEpic(bead);
          if (parentEpic) {
            state.upsertAgentProfile({
              agentId: bestAgent.agentId,
              lastEpicId: parentEpic,
            });
          }

          // 10. Do NOT message the agent — bead-assign-notification handles that (adj-yst2)

          // 11. Log decision
          state.logDecision({
            behavior: "work-assigner",
            action: "assigned",
            target: bead.id,
            reason: `Assigned ${bead.id} (P${bead.priority}) to ${bestAgent.agentId}`,
          });
        }
      } finally {
        assigning = false;
      }
    },
  };
}
