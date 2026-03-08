import type { AdjutantBehavior, BehaviorEvent } from "../behavior-registry.js";
import type { AdjutantState } from "../state-store.js";
import type { CommunicationManager } from "../communication.js";
import type { McpAgentDisconnectedEvent } from "../../event-bus.js";
import type { BeadsIssue } from "../../bd-client.js";
import { execBd } from "../../bd-client.js";
import { updateBead } from "../../beads/beads-mutations.js";

/**
 * Work Rebalancer behavior.
 *
 * When an agent disconnects, returns its in-progress beads to the open pool
 * so the work-assigner can reassign them on its next cycle.
 *
 * CRITICAL (adj-49sr): Only triggers on mcp:agent_disconnected.
 * Do NOT trigger on agent:status_changed to "blocked" -- blocked agents
 * are alive and working, just waiting for something.
 */
export function createWorkRebalancer(): AdjutantBehavior {
  /** Track recently rebalanced bead IDs with timestamps for TTL-based expiry */
  const recentlyRebalanced = new Map<string, number>();

  /** TTL for rebalance records (60 seconds) */
  const REBALANCE_TTL_MS = 60_000;

  /** Prune expired entries from the rebalance tracking map */
  function pruneExpired(): void {
    const now = Date.now();
    for (const [beadId, timestamp] of recentlyRebalanced) {
      if (now - timestamp > REBALANCE_TTL_MS) {
        recentlyRebalanced.delete(beadId);
      }
    }
  }

  return {
    name: "work-rebalancer",
    triggers: ["mcp:agent_disconnected"],
    // No schedule -- only fires on disconnect events

    shouldAct(event: BehaviorEvent, state: AdjutantState): boolean {
      // Only act on disconnect events (adj-49sr: never on status_changed/blocked)
      if (event.name !== "mcp:agent_disconnected") {
        return false;
      }

      const data = event.data as McpAgentDisconnectedEvent;
      const profile = state.getAgentProfile(data.agentId);

      // No profile means unknown agent -- nothing to rebalance
      if (!profile) {
        return false;
      }

      return true;
    },

    async act(event: BehaviorEvent, state: AdjutantState, comm: CommunicationManager): Promise<void> {
      // Prune expired rebalance records
      pruneExpired();

      const data = event.data as McpAgentDisconnectedEvent;
      const agentId = data.agentId;

      // Find in-progress beads assigned to this agent
      const listResult = await execBd<BeadsIssue[]>(
        ["list", "--status", "in_progress", "--assignee", agentId, "--json"],
        {},
      );

      if (!listResult.success || !listResult.data) {
        state.logDecision({
          behavior: "work-rebalancer",
          action: "list_beads_failed",
          target: agentId,
          reason: listResult.error?.message ?? "Failed to list beads",
        });
        return;
      }

      const orphanedBeads = listResult.data;

      if (orphanedBeads.length === 0) {
        return;
      }

      const rebalancedIds: string[] = [];

      for (const bead of orphanedBeads) {
        const result = await updateBead(bead.id, { status: "open", assignee: "" });

        if (result.success) {
          rebalancedIds.push(bead.id);
          recentlyRebalanced.set(bead.id, Date.now());

          state.logDecision({
            behavior: "work-rebalancer",
            action: "bead_unassigned",
            target: bead.id,
            reason: `Agent ${agentId} disconnected, returned bead to open pool`,
          });
        } else {
          state.logDecision({
            behavior: "work-rebalancer",
            action: "bead_unassign_failed",
            target: bead.id,
            reason: `Failed to unassign from ${agentId}: ${result.error?.message ?? "unknown error"}`,
          });
        }
      }

      if (rebalancedIds.length > 0) {
        comm.queueRoutine(
          `Agent ${agentId} disconnected, beads ${rebalancedIds.join(" and ")} returned to open pool`,
        );
      }
    },
  };
}
