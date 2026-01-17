/**
 * Beads service for listing beads from town level.
 * IMPORTANT: gastown_boy is the dashboard for ALL of Gas Town.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { execBd, resolveBeadsDir, type BeadsIssue } from "./bd-client.js";
import { listAllBeadsDirs, resolveTownRoot } from "./gastown-workspace.js";

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
  /** Source database: "town" for hq-*, or rig name for rig-specific beads */
  source: string;
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
  /** Prefixes to exclude (e.g., ["hq-"] to hide town-level system beads) */
  excludePrefixes?: string[];
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
 * Cached prefix-to-source map loaded from routes.jsonl.
 * Maps prefix (e.g., "gb") to rig name (e.g., "gastown_boy").
 */
let prefixToSourceMap: Map<string, string> | null = null;

/**
 * Loads prefix-to-source mapping from routes.jsonl.
 * Extracts rig name from path (e.g., "gastown_boy/mayor/rig" → "gastown_boy").
 */
function loadPrefixMap(): Map<string, string> {
  if (prefixToSourceMap) return prefixToSourceMap;

  prefixToSourceMap = new Map();
  try {
    const townRoot = resolveTownRoot();
    const routesPath = join(townRoot, ".beads", "routes.jsonl");
    const content = readFileSync(routesPath, "utf8");

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      const route = JSON.parse(line) as { prefix: string; path: string };
      // Extract prefix without trailing dash (e.g., "gb-" → "gb")
      const prefix = route.prefix.replace(/-$/, "");
      // Extract rig name from path (first segment, or "town" for ".")
      const rigName = route.path === "." ? "town" : route.path.split("/")[0];
      if (rigName) {
        prefixToSourceMap.set(prefix, rigName);
      }
    }
  } catch {
    // Fallback defaults if routes.jsonl not found
    prefixToSourceMap.set("hq", "town");
    prefixToSourceMap.set("gb", "gastown_boy");
    prefixToSourceMap.set("gt", "gastown");
  }

  return prefixToSourceMap;
}

/**
 * Maps bead prefix to rig name for UI grouping.
 * Reads from routes.jsonl dynamically.
 */
function prefixToSource(beadId: string): string {
  const prefix = beadId.split("-")[0];
  if (!prefix) return "unknown";
  const map = loadPrefixMap();
  return map.get(prefix) ?? "unknown";
}

/**
 * Transform raw BeadsIssue to BeadInfo for the UI.
 * @param issue The raw issue from bd CLI
 * @param _dbSource The database source (unused - we derive from prefix)
 */
function transformBead(issue: BeadsIssue, _dbSource: string): BeadInfo {
  return {
    id: issue.id,
    title: issue.title,
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

/**
 * Fetches beads from a single database.
 */
async function fetchBeadsFromDatabase(
  workDir: string,
  beadsDir: string,
  source: string,
  options: ListBeadsOptions
): Promise<BeadInfo[]> {
  const args = ["list", "--json"];

  const statusesToInclude = parseStatusFilter(options.status);
  const needsClientSideFilter = statusesToInclude !== null && statusesToInclude.length > 1;

  if (statusesToInclude === null) {
    args.push("--all");
  } else if (statusesToInclude.length === 1 && statusesToInclude[0]) {
    args.push("--status", statusesToInclude[0]);
  } else {
    args.push("--all");
  }

  if (options.type) {
    args.push("--type", options.type);
  }

  // When using --all with client-side filtering, request more to ensure
  // low-priority items aren't cut off before filtering. The database
  // may have 1000+ beads with P3 bugs near the end of sorted results.
  const requestLimit = needsClientSideFilter
    ? Math.max((options.limit ?? 100) * 10, 2000)
    : options.limit;
  if (requestLimit) {
    args.push("--limit", requestLimit.toString());
  }

  const result = await execBd<BeadsIssue[]>(args, { cwd: workDir, beadsDir });
  if (!result.success || !result.data) {
    return [];
  }

  let beads = result.data.map((issue) => transformBead(issue, source));

  if (needsClientSideFilter && statusesToInclude) {
    beads = beads.filter((b) =>
      statusesToInclude.includes(b.status.toLowerCase() as BeadStatus)
    );
  }

  return beads;
}

/**
 * Lists beads from a single database (legacy behavior for rig-specific queries).
 */
export async function listBeads(
  options: ListBeadsOptions = {}
): Promise<BeadsServiceResult<BeadInfo[]>> {
  try {
    const townRoot = resolveTownRoot();
    const workDir = options.rigPath ?? townRoot;
    const beadsDir = resolveBeadsDir(workDir);
    const source = options.rig ?? "town";

    let beads = await fetchBeadsFromDatabase(workDir, beadsDir, source, options);

    // Filter by rig if specified AND we're not already querying a rig-specific database.
    if (options.rig && !options.rigPath) {
      beads = beads.filter((b) => b.rig === options.rig);
    }

    // Sort by priority (lower = higher priority), then by updated date
    beads.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      const aDate = a.updatedAt ?? a.createdAt;
      const bDate = b.updatedAt ?? b.createdAt;
      return bDate.localeCompare(aDate);
    });

    if (options.limit && beads.length > options.limit) {
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

/**
 * Lists beads from ALL rig beads databases (excludes town-level hq-* beads).
 * Used when no specific rig is selected to show a unified view.
 */
export async function listAllBeads(
  options: Omit<ListBeadsOptions, "rig" | "rigPath"> = {}
): Promise<BeadsServiceResult<BeadInfo[]>> {
  try {
    const beadsDirs = await listAllBeadsDirs();

    // Only include known rig databases (exclude town-level and user-level beads)
    const knownRigs = new Set(["gastown", "gastown_boy"]);
    const rigDirs = beadsDirs.filter((dirInfo) =>
      dirInfo.rig !== null && knownRigs.has(dirInfo.rig)
    );

    // Fetch from all rig databases in parallel
    const fetchPromises = rigDirs.map(async (dirInfo) => {
      const source = dirInfo.rig!;
      return fetchBeadsFromDatabase(dirInfo.workDir, dirInfo.path, source, options);
    });

    const results = await Promise.all(fetchPromises);
    let allBeads = results.flat();

    // Deduplicate by bead ID (same bead may exist in multiple databases)
    const seenIds = new Set<string>();
    allBeads = allBeads.filter((b) => {
      if (seenIds.has(b.id)) return false;
      seenIds.add(b.id);
      return true;
    });

    // Filter out excluded prefixes (e.g., hq- system beads)
    if (options.excludePrefixes && options.excludePrefixes.length > 0) {
      const prefixes = options.excludePrefixes;
      allBeads = allBeads.filter((b) => !prefixes.some((p) => b.id.startsWith(p)));
    }

    // Sort by priority, then by updated date
    allBeads.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      const aDate = a.updatedAt ?? a.createdAt;
      const bDate = b.updatedAt ?? b.createdAt;
      return bDate.localeCompare(aDate);
    });

    // Apply limit after merging and sorting
    if (options.limit && allBeads.length > options.limit) {
      allBeads = allBeads.slice(0, options.limit);
    }

    return { success: true, data: allBeads };
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
