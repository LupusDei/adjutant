/**
 * Pure sorting functions for beads.
 *
 * Extracted from beads-service.ts. These are pure functions with
 * NO I/O, NO imports from bd-client, NO event bus.
 * Only imports from ./types.js.
 */

import type { BeadInfo } from "./types.js";

// ============================================================================
// Priority + Date Sort
// ============================================================================

/**
 * Sorts beads by priority (lower = higher priority), then by updated date descending.
 * Falls back to createdAt when updatedAt is null.
 *
 * Does NOT mutate the input array; returns a new sorted array.
 */
export function sortByPriorityThenDate(beads: BeadInfo[]): BeadInfo[] {
  return [...beads].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const aDate = a.updatedAt ?? a.createdAt;
    const bDate = b.updatedAt ?? b.createdAt;
    return bDate.localeCompare(aDate);
  });
}

// ============================================================================
// Closed-at Sort
// ============================================================================

/**
 * Sorts items by closedAt timestamp descending (most recent first).
 *
 * Generic: works with any type that has `{ closedAt: string }`.
 * Does NOT mutate the input array; returns a new sorted array.
 */
export function sortByClosedAtDesc<T extends { closedAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime()
  );
}

// ============================================================================
// Updated-at Sort (for epic progress lists)
// ============================================================================

/**
 * Sorts items by updatedAt descending (for epic progress lists).
 * Falls back to createdAt when updatedAt is null.
 *
 * Accepts items with an `epic` property containing a BeadInfo.
 * Does NOT mutate the input array; returns a new sorted array.
 */
export function sortByUpdatedAtDesc(items: { epic: BeadInfo }[]): typeof items {
  return [...items].sort((a, b) => {
    const aTime = a.epic.updatedAt ?? a.epic.createdAt;
    const bTime = b.epic.updatedAt ?? b.epic.createdAt;
    return bTime.localeCompare(aTime);
  });
}

// ============================================================================
// Limit
// ============================================================================

/**
 * Applies a limit to an array (returns first N items).
 * Returns the original array reference if no limiting is needed.
 *
 * @param items The array to limit
 * @param limit Maximum number of items to return (undefined or 0 = no limit)
 */
export function applyLimit<T>(items: T[], limit: number | undefined): T[] {
  if (!limit || items.length <= limit) return items;
  return items.slice(0, limit);
}
