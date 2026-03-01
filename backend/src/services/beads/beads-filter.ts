/**
 * Pure filtering functions for beads.
 *
 * Extracted from beads-service.ts. These are pure functions with
 * NO I/O, NO imports from bd-client, NO event bus.
 * Only imports from ./types.js.
 */

import type { BeadInfo, BeadStatus } from "./types.js";
import { DEFAULT_STATUSES, ALL_STATUSES } from "./types.js";

// ============================================================================
// Status Filtering
// ============================================================================

/**
 * Parses status filter into array of statuses to include.
 * Returns null if all statuses should be shown.
 *
 * Supported filter values:
 *   - undefined / "" / "all" → null (show all)
 *   - "default" → DEFAULT_STATUSES (active work, not closed)
 *   - "open,closed" → ["open", "closed"] (comma-separated)
 *   - Invalid values are silently dropped; if all invalid, returns null.
 */
export function parseStatusFilter(filter: string | undefined): BeadStatus[] | null {
  if (!filter || filter === "all") {
    return null; // Show all
  }
  if (filter === "default") {
    return [...DEFAULT_STATUSES];
  }
  // Handle comma-separated values
  const statuses = filter.split(",").map((s) => s.trim().toLowerCase());
  const valid = statuses.filter((s) => ALL_STATUSES.includes(s as BeadStatus));
  return valid.length > 0 ? (valid as BeadStatus[]) : null;
}

// ============================================================================
// Wisp Exclusion
// ============================================================================

/**
 * Filters out wisps (transient work units) from an array of items.
 * Checks both the explicit `wisp` flag and the `-wisp-` ID pattern.
 *
 * Generic: works with any type that has `{ id: string; wisp?: boolean }`.
 */
export function excludeWisps<T extends { id: string; wisp?: boolean }>(items: T[]): T[] {
  return items.filter((item) => {
    // Use bracket notation: strict mode requires it for index signature access
    if ((item as Record<string, unknown>)["wisp"]) return false;
    if (item.id.includes("-wisp-")) return false;
    return true;
  });
}

// ============================================================================
// Deduplication
// ============================================================================

/**
 * Deduplicates items by ID, keeping the first occurrence.
 *
 * Generic: works with any type that has `{ id: string }`.
 */
export function deduplicateById<T extends { id: string }>(items: T[]): T[] {
  const seenIds = new Set<string>();
  return items.filter((item) => {
    if (seenIds.has(item.id)) return false;
    seenIds.add(item.id);
    return true;
  });
}

// ============================================================================
// Assignee Filtering
// ============================================================================

/**
 * Filters beads by assignee (exact match or last path component match).
 *
 * Examples:
 *   filterByAssignee(beads, "ace")
 *     → matches "project/agents/ace" (last component) and "ace" (exact)
 *   filterByAssignee(beads, "project/agents/ace")
 *     → matches only exact "project/agents/ace"
 */
export function filterByAssignee(beads: BeadInfo[], assignee: string): BeadInfo[] {
  const target = assignee.toLowerCase();
  return beads.filter((b) => {
    if (!b.assignee) return false;
    const a = b.assignee.toLowerCase();
    if (a === target) return true;
    // Match last path component: "project/agents/toast" matches "toast"
    const lastComponent = a.split("/").pop();
    return lastComponent === target;
  });
}

// ============================================================================
// Status Client-Side Filtering
// ============================================================================

/**
 * Filters beads by status array (client-side).
 * Performs case-insensitive comparison.
 */
export function filterByStatuses(beads: BeadInfo[], statuses: BeadStatus[]): BeadInfo[] {
  return beads.filter((b) =>
    statuses.includes(b.status.toLowerCase() as BeadStatus)
  );
}

// ============================================================================
// Prefix Exclusion
// ============================================================================

/**
 * Filters out beads with excluded prefixes (e.g., hq- system beads).
 */
export function excludePrefixes(beads: BeadInfo[], prefixes: string[]): BeadInfo[] {
  return beads.filter((b) => !prefixes.some((p) => b.id.startsWith(p)));
}

// ============================================================================
// Rig Filtering
// ============================================================================

/**
 * Filters beads by rig name.
 */
export function filterByRig(beads: BeadInfo[], rig: string): BeadInfo[] {
  return beads.filter((b) => b.rig === rig);
}
