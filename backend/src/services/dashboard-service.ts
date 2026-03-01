/**
 * Dashboard service — fetches all dashboard sections in parallel.
 *
 * Uses Promise.allSettled so individual section failures don't
 * kill the entire response.
 */

import { getStatusProvider } from "./status/index.js";
import type { SystemStatus } from "./status/index.js";
import { getAgents } from "./agents-service.js";
import { listBeads, listEpicsWithProgress } from "./beads/index.js";
import type { BeadInfo, EpicWithChildren, BeadsServiceResult } from "./beads/types.js";
import type { MessageStore } from "./message-store.js";
import type {
  DashboardResponse,
  DashboardSection,
  BeadCategory,
  EpicWithProgressItem,
} from "../types/dashboard.js";
import type { UnreadAgentSummary } from "./message-store.js";
import type { CrewMember } from "../types/index.js";

// ============================================================================
// Constants
// ============================================================================

const DASHBOARD_BEAD_LIMIT = 5;
const DASHBOARD_EPIC_LIMIT = 5;

// ============================================================================
// Result Wrappers
// ============================================================================

/** Wrap a fulfilled/rejected PromiseSettledResult into a DashboardSection. */
function wrapResult<T, R>(
  result: PromiseSettledResult<T>,
  transform: (value: T) => R | null,
): DashboardSection<R> {
  if (result.status === "fulfilled") {
    const data = transform(result.value);
    return { data };
  }
  return {
    data: null,
    error: result.reason instanceof Error ? result.reason.message : String(result.reason),
  };
}

/** Extract data from a service result (success/data/error pattern). */
function extractServiceData<T>(
  result: { success: boolean; data?: T; error?: { message: string } },
): T | null {
  if (result.success && result.data !== undefined) {
    return result.data;
  }
  if (!result.success && result.error) {
    throw new Error(result.error.message);
  }
  return null;
}

/** Build a BeadCategory from a beads service result. */
function toBeadCategory(result: BeadsServiceResult<BeadInfo[]>): BeadCategory {
  const items = result.success && result.data ? result.data.slice(0, DASHBOARD_BEAD_LIMIT) : [];
  const totalCount = result.success && result.data ? result.data.length : 0;
  return { items, totalCount };
}

/** Wrap three bead results into the combined beads section. */
function wrapBeadsResult(
  inProgressResult: PromiseSettledResult<BeadsServiceResult<BeadInfo[]>>,
  openResult: PromiseSettledResult<BeadsServiceResult<BeadInfo[]>>,
  closedResult: PromiseSettledResult<BeadsServiceResult<BeadInfo[]>>,
): DashboardSection<{ inProgress: BeadCategory; open: BeadCategory; closed: BeadCategory }> {
  const errors: string[] = [];
  for (const r of [inProgressResult, openResult, closedResult]) {
    if (r.status === "rejected") {
      errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
    }
  }
  if (errors.length === 3) {
    return { data: null, error: errors.join("; ") };
  }

  const inProgress =
    inProgressResult.status === "fulfilled"
      ? toBeadCategory(inProgressResult.value)
      : { items: [], totalCount: 0 };
  const open =
    openResult.status === "fulfilled"
      ? toBeadCategory(openResult.value)
      : { items: [], totalCount: 0 };
  const closed =
    closedResult.status === "fulfilled"
      ? toBeadCategory(closedResult.value)
      : { items: [], totalCount: 0 };

  return {
    data: { inProgress, open, closed },
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  };
}

/** Wrap unread counts result. */
function wrapUnreadCounts(
  result: PromiseSettledResult<Array<{ agentId: string; count: number }>>,
): DashboardSection<Record<string, number>> {
  return wrapResult(result, (counts) => {
    const map: Record<string, number> = {};
    for (const c of counts) {
      map[c.agentId] = c.count;
    }
    return map;
  });
}

/** Wrap epics result — split into inProgress and completed. */
function wrapEpicsResult(
  result: PromiseSettledResult<BeadsServiceResult<EpicWithChildren[]>>,
): DashboardSection<{ inProgress: { items: EpicWithProgressItem[]; totalCount: number }; completed: { items: EpicWithProgressItem[]; totalCount: number } }> {
  return wrapResult(result, (serviceResult) => {
    const epics = serviceResult.success && serviceResult.data ? serviceResult.data : [];

    const toProgressItem = (e: EpicWithChildren): EpicWithProgressItem => ({
      epic: e.epic,
      totalCount: e.totalCount,
      closedCount: e.closedCount,
      progress: e.progress,
    });

    const inProgressEpics = epics.filter((e) => e.epic.status !== "closed");
    const completedEpics = epics.filter((e) => e.epic.status === "closed");

    return {
      inProgress: {
        items: inProgressEpics.slice(0, DASHBOARD_EPIC_LIMIT).map(toProgressItem),
        totalCount: inProgressEpics.length,
      },
      completed: {
        items: completedEpics.slice(0, DASHBOARD_EPIC_LIMIT).map(toProgressItem),
        totalCount: completedEpics.length,
      },
    };
  });
}

// ============================================================================
// Service Factory
// ============================================================================

export interface DashboardService {
  fetchDashboard(): Promise<DashboardResponse>;
}

export function createDashboardService(messageStore: MessageStore): DashboardService {
  return {
    async fetchDashboard(): Promise<DashboardResponse> {
      const results = await Promise.allSettled([
        // 0: status
        getStatusProvider().getStatus(),
        // 1: beads in_progress (no limit — totalCount needs full list; slice in toBeadCategory)
        listBeads({ status: "in_progress" }),
        // 2: beads open
        listBeads({ status: "open" }),
        // 3: beads closed
        listBeads({ status: "closed" }),
        // 4: crew
        getAgents(),
        // 5: unread counts (sync method — wrap in async to catch throws)
        (async () => messageStore.getUnreadCounts())(),
        // 6: epics with progress
        listEpicsWithProgress({ status: "all" }),
        // 7: unread message summaries grouped by agent (max 8)
        (async () => messageStore.getUnreadSummaries(8))(),
      ]);

      return {
        status: wrapResult(
          results[0] as PromiseSettledResult<{ success: boolean; data?: SystemStatus; error?: { message: string } }>,
          (r) => extractServiceData(r),
        ),
        beads: wrapBeadsResult(
          results[1] as PromiseSettledResult<BeadsServiceResult<BeadInfo[]>>,
          results[2] as PromiseSettledResult<BeadsServiceResult<BeadInfo[]>>,
          results[3] as PromiseSettledResult<BeadsServiceResult<BeadInfo[]>>,
        ),
        crew: wrapResult(
          results[4] as PromiseSettledResult<{ success: boolean; data?: CrewMember[]; error?: { message: string } }>,
          (r) => extractServiceData(r),
        ),
        unreadCounts: wrapUnreadCounts(
          results[5] as PromiseSettledResult<Array<{ agentId: string; count: number }>>,
        ),
        unreadMessages: wrapResult(
          results[7] as PromiseSettledResult<UnreadAgentSummary[]>,
          (summaries) => summaries,
        ),
        epics: wrapEpicsResult(
          results[6] as PromiseSettledResult<BeadsServiceResult<EpicWithChildren[]>>,
        ),
        mail: { data: null },
        timestamp: new Date().toISOString(),
      };
    },
  };
}
