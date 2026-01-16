/**
 * Beads service for listing beads from town level.
 * IMPORTANT: gastown_boy is the dashboard for ALL of Gas Town.
 */

import { execBd, type BeadsIssue } from "./bd-client.js";
import { resolveTownRoot, resolveBeadsDir } from "./gastown-workspace.js";

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

// Status groups for convenience
const STATUS_GROUPS: Record<string, string[]> = {
  default: ["open", "in_progress", "blocked"],
  active: ["open", "in_progress", "blocked"],
  all: [], // Empty means no filter
};

export async function listBeads(
  options: ListBeadsOptions = {}
): Promise<BeadsServiceResult<BeadsIssue[]>> {
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

    let beads = result.data ?? [];

    // Filter by rig if specified (via assignee prefix)
    if (options.rig) {
      beads = beads.filter(
        (b) => b.assignee?.startsWith(`${options.rig}/`) ?? false
      );
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
