import type { AdjutantBehavior, BehaviorEvent } from "../behavior-registry.js";
import type { AdjutantState } from "../state-store.js";
import type { CommunicationManager } from "../communication.js";
import type { MemoryStore, NewRetrospective } from "../memory-store.js";

/**
 * Gather session metrics from state and memory store.
 */
function gatherMetrics(
  state: AdjutantState,
  memoryStore: MemoryStore,
): {
  beadsClosed: number;
  beadsFailed: number;
  correctionsReceived: number;
  agentsUsed: number;
  avgBeadTimeMins: number | null;
} {
  const today = new Date().toISOString().split("T")[0]!;
  const decisions = state.getRecentDecisions(500);

  // Beads closed: decisions where action contains "close"
  const beadsClosed = decisions.filter(
    (d) => d.action.includes("close"),
  ).length;

  // Beads failed: decisions with "reopen" or "failure" actions
  const beadsFailed = decisions.filter(
    (d) => d.action.includes("reopen") || d.action.includes("failure"),
  ).length;

  // Corrections received: count of unresolved corrections
  const corrections = memoryStore.getUnresolvedCorrections();
  const correctionsReceived = corrections.length;

  // Agents used: distinct agent IDs with today's activity
  const profiles = state.getAllAgentProfiles();
  const agentsUsed = profiles.filter((p) => {
    if (!p.lastActivity) return false;
    return p.lastActivity.startsWith(today);
  }).length;

  // Average bead time: estimate from decision timestamps
  // Use close decisions to estimate — null if not enough data
  const closeDecisions = decisions.filter((d) => d.action.includes("close"));
  let avgBeadTimeMins: number | null = null;
  if (closeDecisions.length >= 2) {
    const timestamps = closeDecisions
      .map((d) => new Date(d.createdAt).getTime())
      .sort((a, b) => a - b);
    const totalSpanMs = timestamps[timestamps.length - 1]! - timestamps[0]!;
    avgBeadTimeMins = Math.round(totalSpanMs / closeDecisions.length / 60000);
  }

  return { beadsClosed, beadsFailed, correctionsReceived, agentsUsed, avgBeadTimeMins };
}

/**
 * Create a session-retrospective behavior that generates daily retrospectives.
 *
 * This behavior:
 * - Runs daily at 11 PM (schedule-only, no event triggers)
 * - Gathers session metrics from state and memory store
 * - Persists the retrospective via memoryStore.insertRetrospective()
 * - Logs decisions for traceability
 */
export function createSessionRetrospective(memoryStore: MemoryStore): AdjutantBehavior {
  return {
    name: "session-retrospective",
    triggers: [],
    schedule: "0 23 * * *", // Daily at 11 PM

    shouldAct(_event: BehaviorEvent, _state: AdjutantState): boolean {
      return true;
    },

    async act(
      _event: BehaviorEvent,
      state: AdjutantState,
      comm: CommunicationManager,
    ): Promise<void> {
      try {
        const today = new Date().toISOString().split("T")[0]!;
        const metrics = gatherMetrics(state, memoryStore);

        const retro: NewRetrospective = {
          sessionDate: today,
          beadsClosed: metrics.beadsClosed,
          beadsFailed: metrics.beadsFailed,
          correctionsReceived: metrics.correctionsReceived,
          agentsUsed: metrics.agentsUsed,
          ...(metrics.avgBeadTimeMins !== null ? { avgBeadTimeMins: metrics.avgBeadTimeMins } : {}),
        };

        memoryStore.insertRetrospective(retro);

        state.logDecision({
          behavior: "session-retrospective",
          action: "retrospective_generated",
          target: today,
          reason: `Closed: ${metrics.beadsClosed}, Failed: ${metrics.beadsFailed}, Corrections: ${metrics.correctionsReceived}, Agents: ${metrics.agentsUsed}`,
        });

        // Silence lint warning for unused comm — will be used in adj-053.3.2
        void comm;
      } catch {
        // Swallow errors — behaviors must be resilient
      }
    },
  };
}
