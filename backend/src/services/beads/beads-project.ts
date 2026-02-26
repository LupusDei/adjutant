/**
 * Project-scoped bead operations.
 *
 * Functions that operate on a specific project path rather than
 * the multi-database town+rigs aggregation pattern.
 */

import { execBd, resolveBeadsDir, type BeadsIssue } from "../bd-client.js";
import type {
  BeadInfo,
  BeadsServiceResult,
  EpicProgress,
  ProjectBeadsOverview,
} from "./types.js";
import { transformBead } from "./beads-transform.js";
import { excludeWisps } from "./beads-filter.js";
import { computeEpicProgressFromDeps, transformClosedEpics } from "./beads-dependency.js";

// ============================================================================
// Project Overview
// ============================================================================

/**
 * Gets a project-scoped beads overview: open, in-progress, and recently closed beads.
 */
export async function getProjectOverview(
  projectPath: string
): Promise<BeadsServiceResult<ProjectBeadsOverview>> {
  try {
    const beadsDir = resolveBeadsDir(projectPath);

    // Fetch open beads
    const openResult = await execBd<BeadsIssue[]>(
      ["list", "--json", "--status", "open"],
      { cwd: projectPath, beadsDir }
    );

    // Fetch in-progress, hooked, and blocked beads (all active work statuses)
    const inProgressResult = await execBd<BeadsIssue[]>(
      ["list", "--json", "--status", "in_progress"],
      { cwd: projectPath, beadsDir }
    );
    const hookedResult = await execBd<BeadsIssue[]>(
      ["list", "--json", "--status", "hooked"],
      { cwd: projectPath, beadsDir }
    );
    const blockedResult = await execBd<BeadsIssue[]>(
      ["list", "--json", "--status", "blocked"],
      { cwd: projectPath, beadsDir }
    );

    // Fetch closed beads for recently-closed (last 24h)
    const closedResult = await execBd<BeadsIssue[]>(
      ["list", "--all", "--json", "--status", "closed"],
      { cwd: projectPath, beadsDir }
    );

    const cutoff24h = Date.now() - 24 * 3600 * 1000;

    const openBeads = (openResult.success && openResult.data)
      ? excludeWisps(openResult.data).map((i) => transformBead(i, "project"))
      : [];

    // Merge in_progress + hooked + blocked into a single list
    const activeIssues: BeadsIssue[] = [
      ...((inProgressResult.success && inProgressResult.data) ? inProgressResult.data : []),
      ...((hookedResult.success && hookedResult.data) ? hookedResult.data : []),
      ...((blockedResult.success && blockedResult.data) ? blockedResult.data : []),
    ];
    const inProgressBeads = excludeWisps(activeIssues).map((i) => transformBead(i, "project"));

    const recentlyClosedBeads = (closedResult.success && closedResult.data)
      ? excludeWisps(closedResult.data)
          .filter((i) => {
            if (!i.closed_at) return false;
            const closedTime = new Date(i.closed_at).getTime();
            return !isNaN(closedTime) && closedTime >= cutoff24h;
          })
          .map((i) => transformBead(i, "project"))
          .sort((a: BeadInfo, b: BeadInfo) => {
            const aDate = a.updatedAt ?? a.createdAt;
            const bDate = b.updatedAt ?? b.createdAt;
            return bDate.localeCompare(aDate);
          })
      : [];

    return {
      success: true,
      data: { open: openBeads, inProgress: inProgressBeads, recentlyClosed: recentlyClosedBeads },
    };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "PROJECT_OVERVIEW_ERROR",
        message: err instanceof Error ? err.message : "Failed to get project overview",
      },
    };
  }
}

// ============================================================================
// Epic Progress
// ============================================================================

/**
 * Computes epic progress for a project.
 * Lists all open/in-progress epics, then counts closed vs total children.
 */
export async function computeEpicProgress(
  projectPath: string
): Promise<BeadsServiceResult<EpicProgress[]>> {
  try {
    const beadsDir = resolveBeadsDir(projectPath);

    const epicsResult = await execBd<BeadsIssue[]>(
      ["list", "--json", "--type", "epic", "--all"],
      { cwd: projectPath, beadsDir }
    );

    if (!epicsResult.success || !epicsResult.data) {
      return { success: true, data: [] };
    }

    const activeEpics = epicsResult.data.filter(
      (e) => e.status === "open" || e.status === "in_progress"
    );

    // Batch: fetch all beads once to build a status lookup map
    const allBeadsResult = await execBd<BeadsIssue[]>(
      ["list", "--all", "--json"],
      { cwd: projectPath, beadsDir }
    );
    const statusMap = new Map<string, string>();
    if (allBeadsResult.success && allBeadsResult.data) {
      for (const bead of allBeadsResult.data) {
        statusMap.set(bead.id, bead.status);
      }
    }

    const progress: EpicProgress[] = [];

    for (const epic of activeEpics) {
      const showResult = await execBd<BeadsIssue[]>(
        ["show", epic.id, "--json"],
        { cwd: projectPath, beadsDir }
      );

      if (!showResult.success || !showResult.data || showResult.data.length === 0) {
        progress.push({
          id: epic.id,
          title: epic.title,
          status: epic.status,
          totalChildren: 0,
          closedChildren: 0,
          completionPercent: 0,
          assignee: epic.assignee ?? null,
        });
        continue;
      }

      const detail = showResult.data[0]!;
      const deps = detail.dependencies ?? [];
      progress.push(computeEpicProgressFromDeps(epic, deps, statusMap));
    }

    // Sort by completion % descending
    progress.sort((a, b) => b.completionPercent - a.completionPercent);

    return { success: true, data: progress };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "EPIC_PROGRESS_ERROR",
        message: err instanceof Error ? err.message : "Failed to compute epic progress",
      },
    };
  }
}

// ============================================================================
// Recently Completed Epics
// ============================================================================

/**
 * Gets recently completed epics for empty-state fallback.
 */
export async function getRecentlyCompletedEpics(
  projectPath: string,
  limit: number = 5
): Promise<BeadsServiceResult<EpicProgress[]>> {
  try {
    const beadsDir = resolveBeadsDir(projectPath);

    const result = await execBd<BeadsIssue[]>(
      ["list", "--json", "--type", "epic", "--status", "closed"],
      { cwd: projectPath, beadsDir }
    );

    if (!result.success || !result.data) {
      return { success: true, data: [] };
    }

    return { success: true, data: transformClosedEpics(result.data, limit) };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "RECENT_EPICS_ERROR",
        message: err instanceof Error ? err.message : "Failed to get recently completed epics",
      },
    };
  }
}
