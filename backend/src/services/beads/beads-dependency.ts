/**
 * Pure dependency/graph functions for the beads service module.
 *
 * This module contains ONLY pure functions that process data.
 * It MUST NOT import from bd-client or perform any I/O.
 * All inputs are passed as arguments; all outputs are return values.
 *
 * Extracted from beads-service.ts as part of the modular decomposition.
 */

import type {
  GraphDependency,
  GraphNode,
  BeadsIssue,
  BeadInfo,
  EpicProgress,
  EpicWithChildren,
} from "./types.js";

// ============================================================================
// Graph Edge Extraction
// ============================================================================

/**
 * Extracts unique dependency edges from an array of issues.
 * Deduplicates bidirectional/duplicate edges using a key set.
 *
 * Each edge is keyed as "issueId->dependsOnId" so identical edges
 * appearing in multiple databases or on both sides of a bidirectional
 * relationship are only emitted once.
 *
 * @param issues - Array of BeadsIssue objects (may have dependencies)
 * @returns Deduplicated array of GraphDependency edges
 */
export function extractGraphEdges(issues: BeadsIssue[]): GraphDependency[] {
  const edgeKeys = new Set<string>();
  const edges: GraphDependency[] = [];
  for (const issue of issues) {
    if (issue.dependencies) {
      for (const dep of issue.dependencies) {
        const key = `${dep.issue_id}->${dep.depends_on_id}`;
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          edges.push({
            issueId: dep.issue_id,
            dependsOnId: dep.depends_on_id,
            type: dep.type,
          });
        }
      }
    }
  }
  return edges;
}

// ============================================================================
// Graph Node Building
// ============================================================================

/**
 * Builds graph nodes from issues, using a prefixToSource function for source mapping.
 *
 * Maps each BeadsIssue to a GraphNode suitable for dependency graph visualization.
 * The `prefixToSourceFn` callback determines the "source" field (e.g., "town" or rig name)
 * based on the bead ID prefix.
 *
 * @param issues - Array of BeadsIssue objects to convert
 * @param prefixToSourceFn - Function mapping bead ID to its source name
 * @returns Array of GraphNode objects in the same order as input
 */
export function buildGraphNodes(
  issues: BeadsIssue[],
  prefixToSourceFn: (beadId: string) => string
): GraphNode[] {
  return issues.map((issue) => ({
    id: issue.id,
    title: issue.title,
    status: issue.status,
    type: issue.issue_type,
    priority: issue.priority,
    assignee: issue.assignee ?? null,
    source: prefixToSourceFn(issue.id),
  }));
}

// ============================================================================
// Epic Children Processing
// ============================================================================

/**
 * Transforms and sorts child issues into BeadInfo array.
 * Filters wisps and sorts by priority then date.
 *
 * Wisps are filtered out by both the `wisp` boolean field and the
 * "-wisp-" substring in the bead ID. Results are sorted by priority
 * ascending (0 = critical first), then by date descending (newest first).
 *
 * @param issues - Raw child issues from bd CLI
 * @param source - Source database name to pass to transform
 * @param transformFn - Function to convert BeadsIssue to BeadInfo
 * @returns Filtered and sorted array of BeadInfo
 */
export function processEpicChildren(
  issues: BeadsIssue[],
  source: string,
  transformFn: (issue: BeadsIssue, source: string) => BeadInfo
): BeadInfo[] {
  const children = issues
    .filter((issue) => !issue.wisp && !issue.id.includes("-wisp-"))
    .map((issue) => transformFn(issue, source));

  children.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const aDate = a.updatedAt ?? a.createdAt;
    const bDate = b.updatedAt ?? b.createdAt;
    return bDate.localeCompare(aDate);
  });

  return children;
}

// ============================================================================
// Epic Progress Computation
// ============================================================================

/**
 * Computes progress for an epic given its dependency list and a status lookup map.
 *
 * Filters dependencies to those where `issue_id` matches the epic,
 * then counts how many of the dependent IDs have "closed" status in the map.
 *
 * @param epic - The epic issue to compute progress for
 * @param deps - All dependency records (may include deps from other epics)
 * @param statusMap - Map of bead ID to current status string
 * @returns EpicProgress object with computed completion percentage
 */
export function computeEpicProgressFromDeps(
  epic: BeadsIssue,
  deps: Array<{ issue_id: string; depends_on_id: string; type: string }>,
  statusMap: Map<string, string>
): EpicProgress {
  const childIds = deps
    .filter((d) => d.issue_id === epic.id)
    .map((d) => d.depends_on_id);

  const closedCount = childIds.filter(
    (id) => statusMap.get(id) === "closed"
  ).length;
  const total = childIds.length;
  const pct = total > 0 ? closedCount / total : 0;

  return {
    id: epic.id,
    title: epic.title,
    status: epic.status,
    totalChildren: total,
    closedChildren: closedCount,
    completionPercent: pct,
    assignee: epic.assignee ?? null,
  };
}

// ============================================================================
// Epic With Children Builder
// ============================================================================

/**
 * Builds EpicWithChildren from an epic's show result.
 * Extracts child deps and computes progress from dependency status.
 *
 * In bd show output, dependency objects are actually full issue objects
 * with a dependency_type field added. The "status" field on each dep
 * record indicates whether that child is closed.
 *
 * @param epicInfo - Pre-transformed BeadInfo for the epic
 * @param detail - Raw BeadsIssue from bd show (contains dependencies)
 * @returns EpicWithChildren with computed progress (children array is empty)
 */
export function buildEpicWithChildren(
  epicInfo: BeadInfo,
  detail: BeadsIssue
): EpicWithChildren {
  const deps = detail.dependencies ?? [];
  const childDeps = deps.filter((d) => d.issue_id === detail.id);
  const totalCount = childDeps.length;
  const closedCount = childDeps.filter((dep) => {
    // The dep object in bd show output is actually a full issue object
    // with a dependency_type field added. Check status field directly.
    const depAsRecord = dep as Record<string, unknown>;
    return depAsRecord["status"] === "closed";
  }).reduce((count) => count + 1, 0);
  const progress = totalCount > 0 ? closedCount / totalCount : 0;

  return {
    epic: epicInfo,
    children: [],
    totalCount,
    closedCount,
    progress,
  };
}

// ============================================================================
// Recently Completed Epics Transform
// ============================================================================

/**
 * Transforms closed epic issues into EpicProgress objects.
 *
 * Filters to epics that have a `closed_at` timestamp, sorts by most
 * recently closed first, and limits to the requested count.
 * All returned epics have completionPercent=1.0 since they are fully closed.
 *
 * @param issues - Array of closed epic issues
 * @param limit - Maximum number of epics to return (default 5)
 * @returns Sorted and limited array of EpicProgress objects
 */
export function transformClosedEpics(
  issues: BeadsIssue[],
  limit: number = 5
): EpicProgress[] {
  return issues
    .filter((e) => e.closed_at)
    .sort((a, b) => {
      const aTime = new Date(a.closed_at!).getTime();
      const bTime = new Date(b.closed_at!).getTime();
      return bTime - aTime;
    })
    .slice(0, limit)
    .map(
      (e): EpicProgress => ({
        id: e.id,
        title: e.title,
        status: e.status,
        totalChildren: 0,
        closedChildren: 0,
        completionPercent: 1.0,
        assignee: e.assignee ?? null,
        closedAt: e.closed_at ?? null,
      })
    );
}
