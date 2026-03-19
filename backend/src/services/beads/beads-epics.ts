/**
 * Epic-specific bead operations.
 *
 * Handles epic type checking, children fetching, and epic listing with progress.
 */

import { execBd, type BeadsIssue } from "../bd-client.js";
import type {
  BeadInfo,
  BeadsServiceResult,
  EpicWithChildren,
} from "./types.js";
import { buildDatabaseList, resolveBeadDatabase } from "./beads-database.js";
import { ensurePrefixMap, prefixToSource } from "./beads-prefix-map.js";
import { transformBead } from "./beads-transform.js";
import { processEpicChildren, buildEpicWithChildren } from "./beads-dependency.js";
import { getActiveProjectName } from "../projects-service.js";

// ============================================================================
// Epic Type Check
// ============================================================================

/**
 * Checks if a bead is an epic by looking up its type.
 * Returns true if the bead is type "epic", false otherwise.
 */
export async function isBeadEpic(
  beadId: string,
  dbInfo?: { workDir: string; beadsDir: string }
): Promise<boolean> {
  const db = dbInfo ?? await resolveBeadDatabase(beadId);
  if ("error" in db) return false;

  const result = await execBd<BeadsIssue[]>(["show", beadId, "--json"], {
    cwd: db.workDir,
    beadsDir: db.beadsDir,
  });

  if (!result.success || !result.data || result.data.length === 0) return false;
  return result.data[0]?.issue_type === "epic";
}

// ============================================================================
// Epic Children
// ============================================================================

/**
 * Gets all children of an epic using the dependency graph (`bd children`).
 * Uses deps, not naming conventions.
 */
export async function getEpicChildren(
  epicId: string
): Promise<BeadsServiceResult<BeadInfo[]>> {
  try {
    await ensurePrefixMap();

    const db = await resolveBeadDatabase(epicId);
    if ("error" in db) {
      return { success: false, error: db.error };
    }

    const result = await execBd<BeadsIssue[]>(
      ["list", "--parent", epicId, "--all", "--json"],
      { cwd: db.workDir, beadsDir: db.beadsDir }
    );

    if (!result.success) {
      return {
        success: false,
        error: {
          code: result.error?.code ?? "CHILDREN_FETCH_ERROR",
          message: result.error?.message ?? `Failed to fetch children for: ${epicId}`,
        },
      };
    }

    if (!result.data || result.data.length === 0) {
      return { success: true, data: [] };
    }

    const source = prefixToSource(epicId);
    const children = processEpicChildren(result.data, source, transformBead);

    return { success: true, data: children };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "EPIC_CHILDREN_ERROR",
        message: err instanceof Error ? err.message : "Failed to get epic children",
      },
    };
  }
}

// ============================================================================
// Epic Listing with Progress
// ============================================================================

/**
 * Gets all epics with their progress computed server-side.
 * Uses `buildDatabaseList` to query only the correct project directory,
 * matching the pattern used by listAllBeads/listBeads.
 *
 * @param options.project - "all" for all databases, specific project name for that project only,
 *                          undefined/empty defaults to the active project
 */
export async function listEpicsWithProgress(
  options: { project?: string; status?: string } = {}
): Promise<BeadsServiceResult<EpicWithChildren[]>> {
  try {
    await ensurePrefixMap();

    // Use buildDatabaseList to resolve the correct database directories.
    // Default to active project when no project specified (avoids serial timeout
    // scanning all databases). Pass "all" explicitly to scan everything.
    const effectiveProject = options.project?.trim() || getActiveProjectName();
    const databasesToQuery = await buildDatabaseList(effectiveProject);

    const listArgs = ["list", "--json", "--type", "epic", "--all", "--limit", "200"];

    // Fetch epics from each database, tracking which db they came from
    const allEpicIssues: Array<{ issue: BeadsIssue; db: { workDir: string; beadsDir: string; source: string } }> = [];

    for (const db of databasesToQuery) {
      const result = await execBd<BeadsIssue[]>(listArgs, {
        cwd: db.workDir,
        beadsDir: db.beadsDir,
      });
      if (result.success && result.data) {
        for (const issue of result.data) {
          allEpicIssues.push({ issue, db });
        }
      }
    }

    // Filter wisps and by status
    let filtered = allEpicIssues.filter((e) => !e.issue.wisp);
    const statusFilter = options.status;
    if (statusFilter && statusFilter !== "all") {
      filtered = filtered.filter((e) => e.issue.status === statusFilter);
    }

    // For each epic, compute progress using its own database
    const results: EpicWithChildren[] = [];
    for (const { issue: epic, db } of filtered) {
      const epicInfo = transformBead(epic, db.source);

      // Closed epics: skip the expensive `bd show` call
      if (epic.status === "closed") {
        const totalCount = epic.dependency_count ?? 0;
        results.push({
          epic: epicInfo,
          children: [],
          totalCount,
          closedCount: totalCount,
          progress: totalCount > 0 ? 1 : 0,
        });
        continue;
      }

      // Open/in-progress epics: fetch children via `bd show` for accurate status
      const showResult = await execBd<BeadsIssue[]>(
        ["show", epic.id, "--json"],
        { cwd: db.workDir, beadsDir: db.beadsDir }
      );

      if (!showResult.success || !showResult.data || showResult.data.length === 0) {
        results.push({ epic: epicInfo, children: [], totalCount: 0, closedCount: 0, progress: 0 });
        continue;
      }

      const detail = showResult.data[0]!;
      results.push(buildEpicWithChildren(epicInfo, detail));
    }

    // Sort by updatedAt descending
    results.sort((a, b) => {
      const aTime = a.epic.updatedAt ?? a.epic.createdAt;
      const bTime = b.epic.updatedAt ?? b.epic.createdAt;
      return bTime.localeCompare(aTime);
    });

    return { success: true, data: results };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "EPICS_PROGRESS_ERROR",
        message: err instanceof Error ? err.message : "Failed to list epics with progress",
      },
    };
  }
}
