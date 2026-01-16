/**
 * Beads service for gastown-boy.
 *
 * Retrieves beads filtered by rig for display in the UI.
 */

import { execBd, type BeadsIssue } from "./bd-client.js";
import { resolveTownRoot } from "./gastown-workspace.js";
import { resolveBeadsDir } from "./bd-client.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Bead display info for the UI.
 */
export interface BeadInfo {
  id: string;
  title: string;
  status: string;
  priority: number;
  type: string;
  assignee: string | null;
  /** Rig name extracted from assignee (e.g., "gastown_boy") or null for town-level */
  rig: string | null;
  labels: string[];
  createdAt: string;
  updatedAt: string | null;
}

/**
 * Result type for beads service operations.
 */
export interface BeadsServiceResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Valid bead status values.
 * Note: "hooked" indicates work assigned to an agent but not yet started.
 */
export type BeadStatus = "open" | "hooked" | "in_progress" | "blocked" | "deferred" | "closed";

/**
 * Status filter can be a single status, comma-separated list, or preset.
 * - "default": Shows active work (open, hooked, in_progress, blocked)
 * - "all": Shows everything
 * - Single status: "open", "hooked", "in_progress", "blocked", "deferred", "closed"
 * - Comma-separated: "open,in_progress,blocked"
 */
export type StatusFilter = BeadStatus | "default" | "all" | string;

/**
 * Options for listing beads.
 */
export interface ListBeadsOptions {
  rig?: string;
  status?: StatusFilter;
  type?: string;
  limit?: number;
}

/**
 * Default status preset: shows active work (not deferred or closed).
 */
const DEFAULT_STATUSES: BeadStatus[] = ["blocked", "in_progress", "hooked", "open"];

/**
 * All valid statuses for filtering.
 */
const ALL_STATUSES: BeadStatus[] = ["open", "hooked", "in_progress", "blocked", "deferred", "closed"];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parses status filter into array of statuses to include.
 * Returns null if all statuses should be shown.
 */
function parseStatusFilter(filter: StatusFilter | undefined): BeadStatus[] | null {
  if (!filter || filter === "all") {
    return null; // Show all
  }
  if (filter === "default") {
    return DEFAULT_STATUSES;
  }
  // Handle comma-separated values
  const statuses = filter.split(",").map((s) => s.trim().toLowerCase());
  const valid = statuses.filter((s) => ALL_STATUSES.includes(s as BeadStatus));
  return valid.length > 0 ? (valid as BeadStatus[]) : null;
}

/**
 * Extracts rig name from assignee path.
 * Examples:
 *   "gastown_boy/polecats/ace" → "gastown_boy"
 *   "gastown/refinery" → "gastown"
 *   "mayor/" → null (town-level)
 *   null → null
 */
function extractRig(assignee: string | null | undefined): string | null {
  if (!assignee) return null;
  // mayor/ is town-level, not a rig
  if (assignee === "mayor/" || assignee.startsWith("mayor/")) return null;
  // Extract first path segment as rig
  const firstSlash = assignee.indexOf("/");
  if (firstSlash > 0) {
    return assignee.substring(0, firstSlash);
  }
  // No slash - could be a rig name directly
  return assignee || null;
}

function transformBead(issue: BeadsIssue): BeadInfo {
  return {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    type: issue.issue_type,
    assignee: issue.assignee ?? null,
    rig: extractRig(issue.assignee),
    labels: issue.labels ?? [],
    createdAt: issue.created_at,
    updatedAt: issue.updated_at ?? null,
  };
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Gets beads for display in the UI.
 * Optionally filtered by rig and status.
 */
export async function listBeads(
  options: ListBeadsOptions = {}
): Promise<BeadsServiceResult<BeadInfo[]>> {
  try {
    const townRoot = resolveTownRoot();
    const beadsDir = resolveBeadsDir(townRoot);

    const args = ["list", "--json"];

    // Filter by rig label if specified
    if (options.rig) {
      args.push("--label", `rig:${options.rig}`);
    }

    // Parse status filter
    const statusesToInclude = parseStatusFilter(options.status);
    const needsClientSideFilter = statusesToInclude !== null && statusesToInclude.length > 1;

    // Handle status filter
    // For multi-status filters (default preset, comma-separated), fetch all and filter client-side
    // For single status, use CLI flag for efficiency
    if (statusesToInclude === null) {
      // Show all statuses
      args.push("--all");
    } else if (statusesToInclude.length === 1) {
      // Single status - use CLI flag
      // Safe to access [0] since we checked length === 1
      const singleStatus = statusesToInclude[0] as BeadStatus;
      if (singleStatus === "closed") {
        args.push("--status", "closed");
      } else {
        // For open/in_progress/blocked/deferred, use the status flag
        args.push("--status", singleStatus);
      }
    } else {
      // Multiple statuses - fetch all and filter client-side
      args.push("--all");
    }

    // Filter by type if specified
    if (options.type) {
      args.push("--type", options.type);
    }

    // Limit results (apply a higher limit if filtering client-side)
    const requestLimit = needsClientSideFilter
      ? Math.max((options.limit ?? 100) * 2, 200) // Fetch more to have enough after filtering
      : options.limit;
    if (requestLimit) {
      args.push("--limit", requestLimit.toString());
    }

    const result = await execBd<BeadsIssue[]>(args, {
      cwd: townRoot,
      beadsDir,
    });

    if (!result.success) {
      return {
        success: false,
        error: {
          code: "BEADS_ERROR",
          message: result.error?.message ?? "Failed to list beads",
        },
      };
    }

    let beads = (result.data ?? []).map(transformBead);

    // Apply client-side status filter if needed
    if (needsClientSideFilter && statusesToInclude) {
      beads = beads.filter((b) =>
        statusesToInclude.includes(b.status.toLowerCase() as BeadStatus)
      );
    }

    // Sort by priority (lower = higher priority), then by updated date
    beads.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      const aDate = a.updatedAt ?? a.createdAt;
      const bDate = b.updatedAt ?? b.createdAt;
      return bDate.localeCompare(aDate); // Newest first
    });

    // Apply final limit if we fetched extra for filtering
    if (needsClientSideFilter && options.limit && beads.length > options.limit) {
      beads = beads.slice(0, options.limit);
    }

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
