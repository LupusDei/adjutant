/**
 * Shared helper for assembling AutoDevelopStatus.
 *
 * Used by both the REST route (GET /api/projects/:id/auto-develop)
 * and the MCP tool (get_auto_develop_status) to avoid duplication (adj-122.10.6).
 */

import type { AutoDevelopStatus } from "../types/auto-develop.js";
import type { ProposalStore } from "./proposal-store.js";
import type { AutoDevelopStore } from "./auto-develop-store.js";

interface ProjectForStatus {
  id: string;
  name: string;
  autoDevelop: boolean;
  autoDevelopPausedAt?: string | null | undefined;
  visionContext?: string | null | undefined;
  autoDevelopProductOwner?: string | null | undefined;
}

/**
 * Build an AutoDevelopStatus object from project data and stores.
 */
export function buildAutoDevelopStatus(
  project: ProjectForStatus,
  proposalStore: ProposalStore | undefined,
  autoDevelopStore: AutoDevelopStore | undefined,
): AutoDevelopStatus {
  const projectIds = [project.id, project.name];
  const pendingProposals = proposalStore?.getProposals({ status: "pending", project: projectIds }) ?? [];
  const escalated = pendingProposals.filter(
    p => p.confidenceScore !== undefined && p.confidenceScore >= 40 && p.confidenceScore < 60,
  ).length;
  const inReview = pendingProposals.length - escalated;
  const accepted = proposalStore?.getProposals({ status: "accepted", project: projectIds }).length ?? 0;
  const dismissed = proposalStore?.getProposals({ status: "dismissed", project: projectIds }).length ?? 0;

  const activeCycle = autoDevelopStore?.getActiveCycle(project.id) ?? null;
  const cycleHistory = autoDevelopStore?.getCycleHistory(project.id) ?? [];
  const completedCycles = cycleHistory.filter(c => c.completedAt !== null).length;

  return {
    enabled: project.autoDevelop,
    paused: !!project.autoDevelopPausedAt,
    pausedAt: project.autoDevelopPausedAt ?? null,
    currentPhase: activeCycle ? (activeCycle.phase as AutoDevelopStatus["currentPhase"]) : null,
    activeCycleId: activeCycle?.id ?? null,
    visionContext: project.visionContext ?? null,
    proposals: { inReview, accepted, escalated, dismissed },
    epicsInExecution: accepted,
    cycleStats: {
      totalCycles: cycleHistory.length,
      completedCycles,
    },
    productOwner: project.autoDevelopProductOwner ?? null,
  };
}
