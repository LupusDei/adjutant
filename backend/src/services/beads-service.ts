/**
 * Beads service for listing beads from town level.
 * IMPORTANT: gastown_boy is the dashboard for ALL of Gas Town.
 */

import { execBd, resolveBeadsDir, type BeadsIssue } from "./bd-client.js";
import { resolveTownRoot } from "./gastown-workspace.js";

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

export interface ListBeadsOptions {
  rig?: string;
  /** Path to rig's directory containing .beads/ - if provided, queries that rig's beads database */
  rigPath?: string;
  status?: string;
  type?: string;
  limit?: number;
}

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
 */
export type BeadStatus = "open" | "hooked" | "in_progress" | "blocked" | "deferred" | "closed";

// ============================================================================
// Helpers
// ============================================================================

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

/**
 * Transform raw BeadsIssue to BeadInfo for the UI.
 */
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

/**
 * Default status preset: shows active work (not deferred or closed).
 */
const DEFAULT_STATUSES: BeadStatus[] = ["blocked", "in_progress", "hooked", "open"];

/**
 * All valid statuses for filtering.
 */
const ALL_STATUSES: BeadStatus[] = ["open", "hooked", "in_progress", "blocked", "deferred", "closed"];

/**
 * Parses status filter into array of statuses to include.
 * Returns null if all statuses should be shown.
 */
function parseStatusFilter(filter: string | undefined): BeadStatus[] | null {
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

export async function listBeads(
  options: ListBeadsOptions = {}
): Promise<BeadsServiceResult<BeadInfo[]>> {
  try {
    const townRoot = resolveTownRoot();

    // Use rig-specific beads dir if rigPath provided, otherwise town-level
    const workDir = options.rigPath ?? townRoot;
    const beadsDir = resolveBeadsDir(workDir);

    const args = ["list", "--json"];

    // Parse status filter
    const statusesToInclude = parseStatusFilter(options.status);
    const needsClientSideFilter = statusesToInclude !== null && statusesToInclude.length > 1;

    // Handle status filter
    // bd CLI doesn't support multiple --status flags, so:
    // - For single status: use CLI flag
    // - For multiple statuses (default preset, comma-separated): fetch all and filter client-side
    if (statusesToInclude === null) {
      // Show all statuses
      args.push("--all");
    } else if (statusesToInclude.length === 1 && statusesToInclude[0]) {
      // Single status - use CLI flag
      args.push("--status", statusesToInclude[0]);
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
      ? Math.max((options.limit ?? 100) * 2, 200)
      : options.limit;
    if (requestLimit) {
      args.push("--limit", requestLimit.toString());
    }

    const result = await execBd<BeadsIssue[]>(args, { cwd: workDir, beadsDir });

    if (!result.success) {
      return {
        success: false,
        error: {
          code: "BD_ERROR",
          message: result.error?.message ?? "Failed to list beads",
        },
      };
    }

    // Transform raw issues to BeadInfo for the UI
    let beads = (result.data ?? []).map(transformBead);

    // Apply client-side status filter if needed
    if (needsClientSideFilter && statusesToInclude) {
      beads = beads.filter((b) =>
        statusesToInclude.includes(b.status.toLowerCase() as BeadStatus)
      );
    }

    // Filter by rig if specified
    if (options.rig) {
      beads = beads.filter((b) => b.rig === options.rig);
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
