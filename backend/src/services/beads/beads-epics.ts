/**
 * Epic-specific bead operations.
 *
 * Handles epic type checking, children fetching, and epic listing with progress.
 */

import { execBd, resolveBeadsDir, type BeadsIssue } from "../bd-client.js";
import { listAllBeadsDirs, resolveWorkspaceRoot } from "../workspace/index.js";
import type {
  BeadInfo,
  BeadsServiceResult,
  EpicWithChildren,
} from "./types.js";
import { resolveBeadDatabase } from "./beads-database.js";
import { ensurePrefixMap, loadPrefixMap, prefixToSource } from "./beads-prefix-map.js";
import { transformBead } from "./beads-transform.js";
import { processEpicChildren, buildEpicWithChildren } from "./beads-dependency.js";

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
      ["children", epicId, "--json"],
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
 * Uses `bd show` per epic to get dependency data (children with status).
 */
export async function listEpicsWithProgress(
  options: { rig?: string; status?: string } = {}
): Promise<BeadsServiceResult<EpicWithChildren[]>> {
  try {
    await ensurePrefixMap();
    const townRoot = resolveWorkspaceRoot();
    const townBeadsDir = resolveBeadsDir(townRoot);

    // Fetch epics from town database
    const listArgs = ["list", "--json", "--type", "epic", "--all", "--limit", "200"];
    const epicResult = await execBd<BeadsIssue[]>(listArgs, {
      cwd: townRoot,
      beadsDir: townBeadsDir,
    });

    if (!epicResult.success || !epicResult.data) {
      return { success: true, data: [] };
    }

    // Also fetch from rig databases
    const beadsDirs = await listAllBeadsDirs();
    const rigDirs = beadsDirs.filter((d) => d.rig !== null);

    const allEpicIssues = [...epicResult.data];
    for (const rigDir of rigDirs) {
      const rigResult = await execBd<BeadsIssue[]>(listArgs, {
        cwd: rigDir.workDir,
        beadsDir: rigDir.path,
      });
      if (rigResult.success && rigResult.data) {
        allEpicIssues.push(...rigResult.data);
      }
    }

    // Filter by status if requested
    const statusFilter = options.status;
    let filteredEpics = allEpicIssues.filter((e) => !e.wisp);
    if (statusFilter && statusFilter !== "all") {
      filteredEpics = filteredEpics.filter((e) => e.status === statusFilter);
    }

    // Build a map of epicId -> {workDir, beadsDir} for bd show lookups
    const epicDbMap = new Map<string, { workDir: string; beadsDir: string }>();
    for (const epic of filteredEpics) {
      const prefix = epic.id.split("-")[0];
      if (!prefix) continue;
      const map = loadPrefixMap();
      const source = map.get(prefix) ?? "town";
      if (source === "town" || source === "unknown") {
        epicDbMap.set(epic.id, { workDir: townRoot, beadsDir: townBeadsDir });
      } else {
        const rigDir = rigDirs.find((d) => d.rig === source);
        if (rigDir) {
          epicDbMap.set(epic.id, { workDir: rigDir.workDir, beadsDir: rigDir.path });
        } else {
          epicDbMap.set(epic.id, { workDir: townRoot, beadsDir: townBeadsDir });
        }
      }
    }

    // For each epic, compute progress
    const results: EpicWithChildren[] = [];
    for (const epic of filteredEpics) {
      const source = prefixToSource(epic.id);
      const epicInfo = transformBead(epic, source);
      const db = epicDbMap.get(epic.id);

      if (!db) {
        results.push({ epic: epicInfo, children: [], totalCount: 0, closedCount: 0, progress: 0 });
        continue;
      }

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

    // Sort by updatedAt descending (in-place to preserve EpicWithChildren type)
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
