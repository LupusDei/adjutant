/**
 * Bead data transformation functions.
 *
 * Converts raw BeadsIssue CLI output to UI-friendly BeadInfo types.
 */

import type { BeadsIssue } from "../bd-client.js";
import type { BeadInfo } from "./types.js";
import { prefixToSource } from "./beads-prefix-map.js";

/**
 * Extracts rig name from assignee path.
 * Examples:
 *   "gastown_boy/polecats/ace" -> "gastown_boy"
 *   "gastown/refinery" -> "gastown"
 *   "mayor/" -> null (town-level)
 *   null -> null
 */
export function extractRig(assignee: string | null | undefined): string | null {
  if (!assignee) return null;
  if (assignee === "mayor/" || assignee.startsWith("mayor/")) return null;
  const firstSlash = assignee.indexOf("/");
  if (firstSlash > 0) {
    return assignee.substring(0, firstSlash);
  }
  return assignee || null;
}

/**
 * Transform raw BeadsIssue to BeadInfo for the UI.
 * @param issue The raw issue from bd CLI
 * @param _dbSource The database source (unused — derived from prefix)
 */
export function transformBead(issue: BeadsIssue, _dbSource: string): BeadInfo {
  return {
    id: issue.id,
    title: issue.title,
    description: issue.description ?? "",
    status: issue.status,
    priority: issue.priority,
    type: issue.issue_type,
    assignee: issue.assignee ?? null,
    rig: extractRig(issue.assignee),
    source: prefixToSource(issue.id),
    labels: issue.labels ?? [],
    createdAt: issue.created_at,
    updatedAt: issue.updated_at ?? null,
  };
}

/** @internal Exported for testing */
export const _extractRig = extractRig;
