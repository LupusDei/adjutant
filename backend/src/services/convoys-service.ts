import { execBd, stripBeadPrefix } from "./bd-client.js";
import { resolveTownRoot, resolveBeadsDir } from "./gastown-workspace.js";
import type { Convoy, TrackedIssue } from "../types/convoys.js";

export interface ConvoysServiceResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/** Convoy bead from bd list --type=convoy */
interface ConvoyBead {
  id: string;
  title: string;
  status: string;
  priority: number;
  issue_type: string;
  updated_at?: string;
}

/** Tracked issue from bd show dependencies */
interface TrackedDep {
  id: string;
  title: string;
  status: string;
  priority?: number;
  issue_type?: string;
  assignee?: string;
  updated_at?: string;
  dependency_type: string;
}

/** Full convoy detail from bd show */
interface ConvoyDetail {
  id: string;
  title: string;
  status: string;
  priority: number;
  issue_type: string;
  updated_at?: string;
  dependencies?: TrackedDep[];
}

/**
 * Extracts rig name from assignee path like "gastown_boy/polecats/toecutter"
 */
function extractRigFromAssignee(assignee: string | undefined): string | null {
  if (!assignee) return null;
  // Assignee format: "rig/polecats/name" or "rig/crew/name"
  const parts = assignee.split("/");
  if (parts.length >= 2 && (parts[1] === "polecats" || parts[1] === "crew")) {
    return parts[0] ?? null;
  }
  return null;
}

export async function listConvoys(): Promise<ConvoysServiceResult<Convoy[]>> {
  try {
    const townRoot = resolveTownRoot();
    const beadsDir = resolveBeadsDir(townRoot);

    // 1. List all open convoy-type beads from town level
    const listResult = await execBd<ConvoyBead[]>(
      ["list", "--type=convoy", "--status=open", "-q", "--json", "--limit=0"],
      { cwd: townRoot, beadsDir }
    );

    if (!listResult.success || !listResult.data) {
      return { success: true, data: [] };
    }

    const convoyBeads = listResult.data;
    if (convoyBeads.length === 0) {
      return { success: true, data: [] };
    }

    // 2. Fetch full details for each convoy (to get dependencies/tracked issues)
    // Note: bd show expects short IDs (without prefix), so we strip the prefix
    const shortIds = convoyBeads.map(c => stripBeadPrefix(c.id));
    const showResult = await execBd<ConvoyDetail[]>(
      ["show", ...shortIds, "-q", "--json"],
      { cwd: townRoot, beadsDir }
    );

    const convoyDetails = new Map<string, ConvoyDetail>();
    if (showResult.success && showResult.data) {
      for (const detail of showResult.data) {
        convoyDetails.set(detail.id, detail);
      }
    }

    // 3. Build convoy response
    const result: Convoy[] = [];

    for (const bead of convoyBeads) {
      const detail = convoyDetails.get(bead.id);
      const deps = detail?.dependencies ?? [];

      // Filter to only "tracks" dependencies (the tracked issues)
      const trackedDeps = deps.filter(d => d.dependency_type === "tracks");

      // Determine rig from tracked issues' assignees
      const rigCounts = new Map<string, number>();
      for (const dep of trackedDeps) {
        const rig = extractRigFromAssignee(dep.assignee);
        if (rig) {
          rigCounts.set(rig, (rigCounts.get(rig) ?? 0) + 1);
        }
      }

      // Pick the most common rig
      let convoyRig: string | null = null;
      let maxCount = 0;
      for (const [rig, count] of rigCounts) {
        if (count > maxCount) {
          maxCount = count;
          convoyRig = rig;
        }
      }

      // Build tracked issues
      const trackedIssues: TrackedIssue[] = [];
      let completed = 0;

      for (const dep of trackedDeps) {
        const tracked: TrackedIssue = {
          id: dep.id,
          title: dep.title,
          status: dep.status
        };
        if (dep.issue_type) tracked.issueType = dep.issue_type;
        if (dep.priority !== undefined) tracked.priority = dep.priority;
        if (dep.assignee) tracked.assignee = dep.assignee;
        if (dep.updated_at) tracked.updatedAt = dep.updated_at;

        trackedIssues.push(tracked);
        if (dep.status === "closed") {
          completed++;
        }
      }

      result.push({
        id: bead.id,
        title: bead.title,
        status: bead.status,
        rig: convoyRig,
        progress: {
          completed,
          total: trackedIssues.length
        },
        trackedIssues
      });
    }

    return { success: true, data: result };

  } catch (err) {
    return {
      success: false,
      error: {
        code: "CONVOYS_ERROR",
        message: err instanceof Error ? err.message : "Failed to list convoys",
      },
    };
  }
}