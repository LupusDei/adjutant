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

// Status groups for convenience
const STATUS_GROUPS: Record<string, string[]> = {
  default: ["open", "in_progress", "blocked"],
  active: ["open", "in_progress", "blocked"],
  all: [], // Empty means no filter
};

export async function listBeads(
  options: ListBeadsOptions = {}
): Promise<BeadsServiceResult<BeadInfo[]>> {
  try {
    const townRoot = resolveTownRoot();
    const beadsDir = resolveBeadsDir(townRoot);

    // Build bd list args
    const args: string[] = ["list", "-q", "--json"];

    // Handle status filtering
    const statusParam = options.status ?? "default";
    if (statusParam !== "all") {
      const statuses = STATUS_GROUPS[statusParam] ?? statusParam.split(",");
      for (const s of statuses) {
        args.push(`--status=${s.trim()}`);
      }
    }

    // Type filter
    if (options.type) {
      args.push(`--type=${options.type}`);
    }

    // Limit
    if (options.limit) {
      args.push(`--limit=${options.limit}`);
    }

    const result = await execBd<BeadsIssue[]>(args, { cwd: townRoot, beadsDir });

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
