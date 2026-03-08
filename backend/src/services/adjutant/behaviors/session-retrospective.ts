import type { AdjutantBehavior, BehaviorEvent } from "../behavior-registry.js";
import type { AdjutantState, AgentProfile } from "../state-store.js";
import type { CommunicationManager } from "../communication.js";
import type { Correction, MemoryStore, NewRetrospective } from "../memory-store.js";

interface SessionMetrics {
  beadsClosed: number;
  beadsFailed: number;
  correctionsReceived: number;
  agentsUsed: number;
  totalAgents: number;
  staleAgents: number;
  avgBeadTimeMins: number | null;
  corrections: Correction[];
}

/**
 * Gather session metrics from state and memory store.
 */
function gatherMetrics(
  state: AdjutantState,
  memoryStore: MemoryStore,
): SessionMetrics {
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

  // Corrections received: unresolved corrections
  const corrections = memoryStore.getUnresolvedCorrections();
  const correctionsReceived = corrections.length;

  // Agents: all profiles and active today
  const profiles = state.getAllAgentProfiles();
  const totalAgents = profiles.length;
  const activeProfiles = profiles.filter((p: AgentProfile) => {
    if (!p.lastActivity) return false;
    return p.lastActivity.startsWith(today);
  });
  const agentsUsed = activeProfiles.length;
  const staleAgents = totalAgents - agentsUsed;

  // Average bead time: estimate from decision timestamps
  const closeDecisions = decisions.filter((d) => d.action.includes("close"));
  let avgBeadTimeMins: number | null = null;
  if (closeDecisions.length >= 2) {
    const timestamps = closeDecisions
      .map((d) => new Date(d.createdAt).getTime())
      .sort((a, b) => a - b);
    const totalSpanMs = timestamps[timestamps.length - 1]! - timestamps[0]!;
    avgBeadTimeMins = Math.round(totalSpanMs / closeDecisions.length / 60000);
  }

  return {
    beadsClosed, beadsFailed, correctionsReceived,
    agentsUsed, totalAgents, staleAgents,
    avgBeadTimeMins, corrections,
  };
}

/**
 * Generate "went well" analysis from metrics.
 */
function generateWentWell(metrics: SessionMetrics): string[] {
  const items: string[] = [];

  if (metrics.beadsClosed > 0) {
    items.push(`Closed ${metrics.beadsClosed} bead${metrics.beadsClosed === 1 ? "" : "s"}`);
  }

  if (metrics.correctionsReceived === 0) {
    items.push("Zero corrections received");
  }

  if (metrics.agentsUsed > 0 && metrics.staleAgents === 0) {
    items.push(`All ${metrics.agentsUsed} agent${metrics.agentsUsed === 1 ? "" : "s"} active today`);
  } else if (metrics.agentsUsed > 0) {
    items.push(`${metrics.agentsUsed} agent${metrics.agentsUsed === 1 ? "" : "s"} active today`);
  }

  if (metrics.beadsFailed === 0 && metrics.beadsClosed > 0) {
    items.push("No bead failures or reopens");
  }

  if (metrics.avgBeadTimeMins !== null && metrics.avgBeadTimeMins > 0) {
    items.push(`Average bead time: ${metrics.avgBeadTimeMins} minutes`);
  }

  return items;
}

/**
 * Generate "went wrong" analysis from metrics.
 */
function generateWentWrong(metrics: SessionMetrics): string[] {
  const items: string[] = [];

  if (metrics.correctionsReceived > 0) {
    items.push(`${metrics.correctionsReceived} correction${metrics.correctionsReceived === 1 ? "" : "s"} received`);
  }

  if (metrics.beadsFailed > 0) {
    items.push(`${metrics.beadsFailed} bead failure${metrics.beadsFailed === 1 ? "" : "s"} or reopen${metrics.beadsFailed === 1 ? "" : "s"} detected`);
  }

  if (metrics.staleAgents > 0) {
    items.push(`${metrics.staleAgents} agent${metrics.staleAgents === 1 ? "" : "s"} went stale or inactive`);
  }

  return items;
}

/**
 * Generate action items from went_wrong analysis and unresolved corrections.
 */
function generateActionItems(
  wentWrong: string[],
  corrections: Correction[],
): string[] {
  const items: string[] = [];

  // Derive action items from each went_wrong item
  for (const issue of wentWrong) {
    if (issue.toLowerCase().includes("correction")) {
      items.push("Review and resolve pending corrections");
    } else if (issue.toLowerCase().includes("failure") || issue.toLowerCase().includes("reopen")) {
      items.push("Investigate bead failures and address root causes");
    } else if (issue.toLowerCase().includes("stale") || issue.toLowerCase().includes("inactive")) {
      items.push("Check on stale agents and reassign their work if needed");
    }
  }

  // Add specific action items for high-recurrence corrections
  for (const correction of corrections) {
    if (correction.recurrenceCount >= 2) {
      items.push(`Address recurring correction: "${correction.description}" (occurred ${correction.recurrenceCount} times)`);
    }
  }

  return items;
}

/**
 * Format the retrospective as a markdown summary.
 */
function formatRetroMarkdown(
  date: string,
  metrics: SessionMetrics,
  wentWell: string[],
  wentWrong: string[],
  actionItems: string[],
): string {
  const lines: string[] = [];

  lines.push(`## Daily Retrospective - ${date}`);
  lines.push("");
  lines.push("### Metrics");
  lines.push(`- Beads closed: ${metrics.beadsClosed}`);
  lines.push(`- Beads failed: ${metrics.beadsFailed}`);
  lines.push(`- Corrections: ${metrics.correctionsReceived}`);
  lines.push(`- Agents active: ${metrics.agentsUsed}`);
  if (metrics.avgBeadTimeMins !== null) {
    lines.push(`- Avg bead time: ${metrics.avgBeadTimeMins} min`);
  }

  if (wentWell.length > 0) {
    lines.push("");
    lines.push("### Went Well");
    for (const item of wentWell) {
      lines.push(`- ${item}`);
    }
  }

  if (wentWrong.length > 0) {
    lines.push("");
    lines.push("### Went Wrong");
    for (const item of wentWrong) {
      lines.push(`- ${item}`);
    }
  }

  if (actionItems.length > 0) {
    lines.push("");
    lines.push("### Action Items");
    for (const item of actionItems) {
      lines.push(`- [ ] ${item}`);
    }
  }

  return lines.join("\n");
}

/**
 * Create a session-retrospective behavior that generates daily retrospectives.
 *
 * This behavior:
 * - Runs daily at 11 PM (schedule-only, no event triggers)
 * - Gathers session metrics from state and memory store
 * - Generates went_well, went_wrong, action_items analysis
 * - Persists the retrospective via memoryStore.insertRetrospective()
 * - Sends formatted markdown summary to user
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

        // Generate analysis
        const wentWell = generateWentWell(metrics);
        const wentWrong = generateWentWrong(metrics);
        const actionItems = generateActionItems(wentWrong, metrics.corrections);

        const retro: NewRetrospective = {
          sessionDate: today,
          beadsClosed: metrics.beadsClosed,
          beadsFailed: metrics.beadsFailed,
          correctionsReceived: metrics.correctionsReceived,
          agentsUsed: metrics.agentsUsed,
          ...(metrics.avgBeadTimeMins !== null ? { avgBeadTimeMins: metrics.avgBeadTimeMins } : {}),
          wentWell: JSON.stringify(wentWell),
          wentWrong: JSON.stringify(wentWrong),
          actionItems: JSON.stringify(actionItems),
        };

        memoryStore.insertRetrospective(retro);

        // Send formatted markdown summary to user
        const markdown = formatRetroMarkdown(today, metrics, wentWell, wentWrong, actionItems);
        await comm.sendImportant(markdown);

        // Update last retro timestamp
        state.setMeta("last_retro_at", new Date().toISOString());

        state.logDecision({
          behavior: "session-retrospective",
          action: "retrospective_generated",
          target: today,
          reason: `Closed: ${metrics.beadsClosed}, Failed: ${metrics.beadsFailed}, Corrections: ${metrics.correctionsReceived}, Agents: ${metrics.agentsUsed}`,
        });
      } catch {
        // Swallow errors — behaviors must be resilient
      }
    },
  };
}
