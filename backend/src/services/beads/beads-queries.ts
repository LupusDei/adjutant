/**
 * Bead query/list operations.
 *
 * Read-only operations that fetch and aggregate beads across databases.
 */

import { execBd, resolveBeadsDir, type BeadsIssue } from "../bd-client.js";
import { resolveWorkspaceRoot } from "../workspace/index.js";
import { logInfo } from "../../utils/index.js";
import type {
  BeadInfo,
  BeadDetail,
  BeadsServiceResult,
  ListBeadsOptions,
  BeadsGraphOptions,
  FetchResult,
  RecentlyClosedBead,
} from "./types.js";
import type { BeadsGraphResponse } from "../../types/beads.js";
import {
  ensurePrefixMap,
  prefixToSource,
} from "./beads-prefix-map.js";
import { extractProject } from "./beads-transform.js";
import {
  buildDatabaseList,
  fetchBeadsFromDatabase,
  fetchGraphBeadsFromDatabase,
  resolveBeadDatabase,
} from "./beads-database.js";
import {
  deduplicateById,
  excludeWisps,
  excludePrefixes,
  filterByAssignee,
} from "./beads-filter.js";
import {
  sortByPriorityThenDate,
  sortByClosedAtDesc,
  sortByUpdatedAtDescFlat,
  applyLimit,
} from "./beads-sorter.js";
import {
  extractGraphEdges,
  buildGraphNodes,
  filterGraphToEpicSubtree,
} from "./beads-dependency.js";

// ============================================================================
// Single Bead
// ============================================================================

/**
 * Gets detailed information about a single bead.
 * @param beadId Full bead ID (e.g., "hq-vts8" or "adj-67tta")
 */
export async function getBead(
  beadId: string
): Promise<BeadsServiceResult<BeadDetail>> {
  try {
    await ensurePrefixMap();

    const prefix = beadId.split("-")[0];
    if (!prefix) {
      return {
        success: false,
        error: { code: "INVALID_BEAD_ID", message: `Invalid bead ID format: ${beadId}` },
      };
    }

    const db = await resolveBeadDatabase(beadId);
    if ("error" in db) {
      return { success: false, error: db.error };
    }

    const result = await execBd<BeadsIssue[]>(["show", beadId, "--json"], {
      cwd: db.workDir,
      beadsDir: db.beadsDir,
    });

    if (!result.success || !result.data || result.data.length === 0) {
      return {
        success: false,
        error: {
          code: result.error?.code ?? "BEAD_NOT_FOUND",
          message: result.error?.message ?? `Bead not found: ${beadId}`,
        },
      };
    }

    const issue = result.data[0];
    if (!issue) {
      return {
        success: false,
        error: { code: "BEAD_NOT_FOUND", message: `Bead not found: ${beadId}` },
      };
    }

    const detail: BeadDetail = {
      id: issue.id,
      title: issue.title,
      description: issue.description ?? "",
      status: issue.status,
      priority: issue.priority,
      type: issue.issue_type,
      assignee: issue.assignee ?? null,
      project: extractProject(issue.assignee),
      source: prefixToSource(issue.id),
      labels: issue.labels ?? [],
      createdAt: issue.created_at,
      updatedAt: issue.updated_at ?? null,
      closedAt: issue.closed_at ?? null,
      agentState: issue.agent_state ?? null,
      // bd show returns dependencies as full issue objects with {id, dependency_type, ...}
      // NOT as {issue_id, depends_on_id, type} tuples (that's bd list format).
      dependencies: (issue.dependencies ?? []).map((d) => {
        const dep = d as Record<string, unknown>;
        // bd show format: full issue objects with dependency_type
        if (typeof dep["dependency_type"] === "string" && typeof dep["id"] === "string") {
          return {
            issueId: beadId,
            dependsOnId: dep["id"] as string,
            type: dep["dependency_type"] as string,
          };
        }
        // bd list format: {issue_id, depends_on_id, type} tuples
        return {
          issueId: d.issue_id,
          dependsOnId: d.depends_on_id,
          type: d.type,
        };
      }),
      isWisp: issue.wisp ?? false,
      isPinned: issue.pinned ?? false,
    };

    return { success: true, data: detail };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "GET_BEAD_ERROR",
        message: err instanceof Error ? err.message : "Failed to get bead",
      },
    };
  }
}

// ============================================================================
// List Operations
// ============================================================================

/**
 * Lists beads from a single database (legacy behavior for project-specific queries).
 */
export async function listBeads(
  options: ListBeadsOptions = {}
): Promise<BeadsServiceResult<BeadInfo[]>> {
  try {
    await ensurePrefixMap();

    const townRoot = resolveWorkspaceRoot();
    const workDir = options.projectPath ?? townRoot;
    const beadsDir = resolveBeadsDir(workDir);
    const source = options.project ?? "town";

    const fetchResult = await fetchBeadsFromDatabase(workDir, beadsDir, source, options);

    if (fetchResult.error) {
      return {
        success: false,
        error: { code: fetchResult.error.code, message: fetchResult.error.message },
      };
    }

    let beads = fetchResult.beads;

    // Filter by project if specified AND we're not already querying a project-specific database
    if (options.project && !options.projectPath) {
      beads = beads.filter((b) => b.project === options.project);
    }

    if (options.assignee) {
      beads = filterByAssignee(beads, options.assignee);
    }

    // Skip re-sort when bd already sorted by a specific field.
    // For closed-only queries, sort by most recently updated (not priority)
    // to avoid P2+ beads being truncated past the limit.
    if (!options.sort) {
      if (options.status === "closed") {
        beads = sortByUpdatedAtDescFlat(beads);
      } else {
        beads = sortByPriorityThenDate(beads);
      }
    }
    beads = applyLimit(beads, options.limit);

    return { success: true, data: beads };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "BEADS_ERROR",
        message: err instanceof Error ? err.message : "Failed to list beads",
      },
    };
  }
}

/**
 * Lists beads from town AND project beads databases.
 * IMPORTANT: Adjutant is the dashboard for ALL of Gas Town.
 */
export async function listAllBeads(
  options: Omit<ListBeadsOptions, "project" | "projectPath"> = {}
): Promise<BeadsServiceResult<BeadInfo[]>> {
  const perfStart = Date.now();
  try {
    await ensurePrefixMap();

    const databasesToQuery = await buildDatabaseList("all");

    // Fetch from all databases sequentially (serialized through bd semaphore)
    const fetchResults: FetchResult[] = [];
    const errors: Array<{ source: string; error: { code: string; message: string } }> = [];

    for (const db of databasesToQuery) {
      const result = await fetchBeadsFromDatabase(db.workDir, db.beadsDir, db.source, options);
      fetchResults.push(result);
      if (result.error) {
        errors.push({ source: db.source, error: result.error });
      }
    }

    // If ALL databases failed, return an error
    if (errors.length === databasesToQuery.length && databasesToQuery.length > 0) {
      const firstError = errors[0]!;
      return {
        success: false,
        error: {
          code: firstError.error.code,
          message: `All bead databases failed. First error: ${firstError.error.message}`,
        },
      };
    }

    if (errors.length > 0) {
      logInfo("listAllBeads partial failure", {
        totalDbs: databasesToQuery.length,
        failedDbs: errors.length,
        errors: errors.map((e) => `${e.source}: ${e.error.message}`),
      });
    }

    let allBeads = fetchResults.flatMap((r) => r.beads);

    allBeads = deduplicateById(allBeads);

    if (options.excludePrefixes && options.excludePrefixes.length > 0) {
      allBeads = excludePrefixes(allBeads, options.excludePrefixes);
    }

    if (options.assignee) {
      allBeads = filterByAssignee(allBeads, options.assignee);
    }

    // Skip re-sort when bd already sorted by a specific field.
    // For closed-only queries, sort by most recently updated (not priority)
    // to avoid P2+ beads being truncated past the limit.
    if (!options.sort) {
      if (options.status === "closed") {
        allBeads = sortByUpdatedAtDescFlat(allBeads);
      } else {
        allBeads = sortByPriorityThenDate(allBeads);
      }
    }
    allBeads = applyLimit(allBeads, options.limit);

    logInfo("listAllBeads complete", { durationMs: Date.now() - perfStart, beadCount: allBeads.length });
    return { success: true, data: allBeads };
  } catch (err) {
    logInfo("listAllBeads error", { durationMs: Date.now() - perfStart, error: err instanceof Error ? err.message : String(err) });
    return {
      success: false,
      error: {
        code: "BEADS_ERROR",
        message: err instanceof Error ? err.message : "Failed to list beads",
      },
    };
  }
}

// ============================================================================
// Recently Closed
// ============================================================================

const RECENT_CLOSED_LIMIT = 10;

/**
 * Lists beads closed within a configurable time window.
 * Queries all databases (town + projects), filters by closed_at timestamp.
 */
export async function listRecentlyClosed(
  hours: number = 1
): Promise<BeadsServiceResult<RecentlyClosedBead[]>> {
  try {
    await ensurePrefixMap();

    const databasesToQuery = await buildDatabaseList("all");
    const cutoffMs = Date.now() - hours * 3600 * 1000;

    const allClosed: RecentlyClosedBead[] = [];

    for (const db of databasesToQuery) {
      const result = await execBd<BeadsIssue[]>(
        ["list", "--all", "--status", "closed", "--json", "--sort", "closed", "--reverse", "--limit", "200"],
        { cwd: db.workDir, beadsDir: db.beadsDir }
      );

      if (!result.success || !result.data) continue;

      for (const issue of excludeWisps(result.data)) {
        if (!issue.closed_at) continue;

        const closedTime = new Date(issue.closed_at).getTime();
        if (isNaN(closedTime) || closedTime < cutoffMs) continue;

        allClosed.push({
          id: issue.id,
          title: issue.title,
          assignee: issue.assignee ?? null,
          closedAt: issue.closed_at,
          type: issue.issue_type,
          priority: issue.priority,
          project: extractProject(issue.assignee),
          source: prefixToSource(issue.id),
        });
      }
    }

    const deduplicated = deduplicateById(allClosed);
    const sorted = sortByClosedAtDesc(deduplicated);
    const limited = sorted.slice(0, RECENT_CLOSED_LIMIT);

    return { success: true, data: limited };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "RECENT_CLOSED_ERROR",
        message: err instanceof Error ? err.message : "Failed to list recently closed beads",
      },
    };
  }
}

// ============================================================================
// Dependency Graph
// ============================================================================

/**
 * Builds a dependency graph of all beads for visualization.
 */
export async function getBeadsGraph(
  options: BeadsGraphOptions = {}
): Promise<BeadsServiceResult<BeadsGraphResponse>> {
  try {
    await ensurePrefixMap();

    const project = options.project?.trim() || "town";
    const databasesToQuery = await buildDatabaseList(project);

    // Fetch from all databases sequentially
    const allIssues: BeadsIssue[] = [];
    const errors: Array<{ source: string; error: { code: string; message: string } }> = [];

    for (const db of databasesToQuery) {
      const fetchResult = await fetchGraphBeadsFromDatabase(db.workDir, db.beadsDir, options);
      if (fetchResult.error) {
        errors.push({ source: db.source, error: fetchResult.error });
      }
      allIssues.push(...fetchResult.issues);
    }

    // If ALL databases failed, return the first error
    if (errors.length === databasesToQuery.length && databasesToQuery.length > 0) {
      const firstError = errors[0]!;
      return {
        success: false,
        error: { code: firstError.error.code, message: firstError.error.message },
      };
    }

    // Deduplicate issues by bead ID
    const uniqueIssues = deduplicateById(allIssues);

    // Filter out excluded prefixes when excludeTown is set
    let issues = uniqueIssues;
    if (options.excludeTown && project === "all") {
      issues = issues.filter((issue) => !issue.id.startsWith("hq-"));
    }

    // Filter to epic subtree when epicId is provided
    if (options.epicId) {
      issues = filterGraphToEpicSubtree(issues, options.epicId);
    }

    const nodes = buildGraphNodes(issues, prefixToSource);
    const edges = extractGraphEdges(issues);

    return { success: true, data: { nodes, edges } };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "GRAPH_ERROR",
        message: err instanceof Error ? err.message : "Failed to build beads graph",
      },
    };
  }
}
