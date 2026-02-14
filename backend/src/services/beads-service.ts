/**
 * Beads service for listing beads from town level.
 * IMPORTANT: Adjutant is the dashboard for ALL of Gas Town.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { execBd, resolveBeadsDir, type BeadsIssue } from "./bd-client.js";
import { listAllBeadsDirs, resolveWorkspaceRoot } from "./workspace/index.js";
import { getEventBus } from "./event-bus.js";
import { logInfo } from "../utils/index.js";

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

/**
 * Detailed bead info for the detail view.
 * Includes description and relationship info.
 */
export interface BeadDetail extends BeadInfo {
  description: string;
  closedAt: string | null;
  /** Agent state if assigned (working, idle, stuck, stale) */
  agentState: string | null;
  /** Dependencies this bead has */
  dependencies: Array<{
    issueId: string;
    dependsOnId: string;
    type: string;
  }>;
  /** Whether this is a wisp (transient work unit) */
  isWisp: boolean;
  /** Whether this is pinned */
  isPinned: boolean;
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
 * Valid bead status values for Kanban workflow.
 * Workflow: open -> hooked/in_progress/blocked -> closed
 */
export type BeadStatus =
  | "open"         // Ready to be picked up
  | "hooked"       // Agent has task on hook
  | "in_progress"  // Actively being worked
  | "blocked"      // Blocked on something
  | "closed";      // Totally done

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
 * Cached prefix-to-source map built from beads config files.
 * Maps prefix (e.g., "gb") to rig name (e.g., "gastown_boy").
 */
let prefixToSourceMap: Map<string, string> | null = null;

/**
 * Default prefix map refresh interval: 5 minutes
 */
const DEFAULT_PREFIX_MAP_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

let prefixMapRefreshIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Reads the issue prefix from a .beads/config.yaml file.
 * Returns null if not found or unreadable.
 */
function readPrefixFromConfig(beadsDir: string): string | null {
  try {
    const configPath = join(beadsDir, "config.yaml");
    const content = readFileSync(configPath, "utf8");
    // Simple YAML parsing for prefix field (handles both "prefix:" and "issue-prefix:")
    const prefixMatch = content.match(/^(?:prefix|issue-prefix):\s*["']?([a-zA-Z0-9_-]+)["']?\s*$/m);
    return prefixMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Builds prefix-to-source mapping dynamically from discovered beads directories.
 * Reads the prefix from each rig's .beads/config.yaml file.
 */
async function buildPrefixMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  // Town beads always use "hq" prefix
  map.set("hq", "town");

  try {
    const beadsDirs = await listAllBeadsDirs();

    for (const dirInfo of beadsDirs) {
      if (!dirInfo.rig) continue; // Skip town-level (already added)

      const prefix = readPrefixFromConfig(dirInfo.path);
      if (prefix) {
        map.set(prefix, dirInfo.rig);
      }
    }
  } catch {
    // If discovery fails, map will just have the "hq" → "town" default
  }

  return map;
}

/**
 * Loads prefix-to-source mapping, building it dynamically if not cached.
 */
function loadPrefixMap(): Map<string, string> {
  if (prefixToSourceMap) return prefixToSourceMap;

  // Synchronous fallback - will be replaced by async version on first listAllBeads call
  prefixToSourceMap = new Map();
  prefixToSourceMap.set("hq", "town");
  return prefixToSourceMap;
}

/**
 * Ensures prefix map is built (call this before using prefixToSource).
 */
async function ensurePrefixMap(): Promise<void> {
  if (!prefixToSourceMap || prefixToSourceMap.size <= 1) {
    prefixToSourceMap = await buildPrefixMap();
  }
}

/**
 * Force refresh the prefix map. Call this when rigs are added/removed.
 */
export async function refreshPrefixMap(): Promise<void> {
  prefixToSourceMap = await buildPrefixMap();
  logInfo("prefix map refreshed", { prefixCount: prefixToSourceMap.size });
}

/**
 * Start the prefix map refresh scheduler.
 * Runs refresh periodically to pick up new rigs.
 * @param intervalMs - Interval in milliseconds (default: 5 minutes)
 */
export function startPrefixMapRefreshScheduler(
  intervalMs: number = DEFAULT_PREFIX_MAP_REFRESH_INTERVAL_MS
): void {
  if (prefixMapRefreshIntervalId !== null) {
    return;
  }

  // Build map immediately on start
  buildPrefixMap()
    .then((map) => {
      prefixToSourceMap = map;
      logInfo("prefix map initialized", { prefixCount: map.size });
    })
    .catch((err) => {
      console.error("[BeadsService] Initial prefix map build failed:", err);
    });

  // Schedule periodic refresh
  prefixMapRefreshIntervalId = setInterval(() => {
    buildPrefixMap()
      .then((map) => {
        const oldSize = prefixToSourceMap?.size ?? 0;
        prefixToSourceMap = map;
        if (map.size !== oldSize) {
          logInfo("prefix map refreshed", {
            oldPrefixCount: oldSize,
            newPrefixCount: map.size,
          });
        }
      })
      .catch((err) => {
        console.error("[BeadsService] Prefix map refresh failed:", err);
      });
  }, intervalMs);

  logInfo("prefix map refresh scheduler started", {
    intervalMin: Math.round(intervalMs / 60000),
  });
}

/**
 * Stop the prefix map refresh scheduler.
 */
export function stopPrefixMapRefreshScheduler(): void {
  if (prefixMapRefreshIntervalId !== null) {
    clearInterval(prefixMapRefreshIntervalId);
    prefixMapRefreshIntervalId = null;
    logInfo("prefix map refresh scheduler stopped");
  }
}

/**
 * Maps bead prefix to rig name for UI grouping.
 * Uses dynamically built prefix map from rig config files.
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
 * Default status preset: shows active work (not closed).
 */
const DEFAULT_STATUSES: BeadStatus[] = [
  "open", "hooked", "in_progress", "blocked"
];

/**
 * All valid statuses for filtering.
 */
const ALL_STATUSES: BeadStatus[] = [
  "open", "hooked", "in_progress", "blocked", "closed"
];

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

  // Filter out wisps (transient work units) - they clutter the UI
  const nonWispIssues = result.data.filter((issue) => {
    // Check explicit wisp flag or wisp in ID pattern
    if (issue.wisp) return false;
    if (issue.id.includes("-wisp-")) return false;
    return true;
  });

  let beads = nonWispIssues.map((issue) => transformBead(issue, source));

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
    // Build prefix map for source mapping in transformBead
    await ensurePrefixMap();

    const townRoot = resolveWorkspaceRoot();
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
 * Lists beads from town AND rig beads databases.
 * IMPORTANT: Adjutant is the dashboard for ALL of Gas Town.
 * By default, this shows town-level hq-* beads (the unified view).
 */
export async function listAllBeads(
  options: Omit<ListBeadsOptions, "rig" | "rigPath"> = {}
): Promise<BeadsServiceResult<BeadInfo[]>> {
  const perfStart = Date.now();
  try {
    // Build prefix map from discovered rigs (for source mapping in transformBead)
    await ensurePrefixMap();

    const townRoot = resolveWorkspaceRoot();
    const beadsDirs = await listAllBeadsDirs();

    // Include town beads (hq-*) - this is the primary source
    const townBeadsDir = join(townRoot, ".beads");
    const databasesToQuery: Array<{ workDir: string; beadsDir: string; source: string }> = [
      { workDir: townRoot, beadsDir: townBeadsDir, source: "town" },
    ];

    // Also include all discovered rig databases for rig-specific beads
    const rigDirs = beadsDirs.filter((dirInfo) => dirInfo.rig !== null);
    for (const dirInfo of rigDirs) {
      databasesToQuery.push({
        workDir: dirInfo.workDir,
        beadsDir: dirInfo.path,
        source: dirInfo.rig!,
      });
    }

    // Fetch from all databases in parallel (town + rigs)
    const fetchPromises = databasesToQuery.map(async (db) => {
      return fetchBeadsFromDatabase(db.workDir, db.beadsDir, db.source, options);
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

    logInfo("listAllBeads complete", { durationMs: Date.now() - perfStart, beadCount: allBeads.length });
    return { success: true, data: allBeads };
  } catch (err) {
    logInfo("listAllBeads error", { durationMs: Date.now() - perfStart, error: err instanceof Error ? err.message : String(err) });
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
 * Updates a bead's status.
 * @param beadId Full bead ID (e.g., "hq-vts8" or "gb-53tj")
 * @param status New status value
 * @returns Result with success/error info
 */
export async function updateBeadStatus(
  beadId: string,
  status: BeadStatus
): Promise<BeadsServiceResult<{ id: string; status: string }>> {
  try {
    // Validate status
    if (!ALL_STATUSES.includes(status)) {
      return {
        success: false,
        error: {
          code: "INVALID_STATUS",
          message: `Invalid status: ${status}. Valid values: ${ALL_STATUSES.join(", ")}`,
        },
      };
    }

    // Build prefix map to determine which database to use
    await ensurePrefixMap();

    // Get the prefix from the bead ID
    const prefix = beadId.split("-")[0];
    if (!prefix) {
      return {
        success: false,
        error: {
          code: "INVALID_BEAD_ID",
          message: `Invalid bead ID format: ${beadId}`,
        },
      };
    }

    // Determine which database this bead belongs to
    const map = loadPrefixMap();
    const source = map.get(prefix);

    let workDir: string;
    let beadsDir: string;

    if (!source || source === "town") {
      // Town-level bead (hq-*)
      const townRoot = resolveWorkspaceRoot();
      workDir = townRoot;
      beadsDir = resolveBeadsDir(townRoot);
    } else {
      // Rig-specific bead - need to find the rig path
      const beadsDirs = await listAllBeadsDirs();
      const rigDir = beadsDirs.find((d) => d.rig === source);
      if (!rigDir) {
        return {
          success: false,
          error: {
            code: "RIG_NOT_FOUND",
            message: `Cannot find rig database for prefix: ${prefix}`,
          },
        };
      }
      workDir = rigDir.workDir;
      beadsDir = rigDir.path;
    }

    // Execute bd update command
    // bd update expects the short ID (without prefix)
    const shortId = beadId.includes("-") ? beadId.split("-").slice(1).join("-") : beadId;
    const args = ["update", shortId, "--status", status];

    const result = await execBd<void>(args, { cwd: workDir, beadsDir, parseJson: false });

    if (!result.success) {
      return {
        success: false,
        error: {
          code: result.error?.code ?? "UPDATE_FAILED",
          message: result.error?.message ?? "Failed to update bead status",
        },
      };
    }

    // Emit bead event for SSE/WebSocket consumers
    const eventType = status === "closed" ? "bead:closed" : "bead:updated";
    if (eventType === "bead:closed") {
      getEventBus().emit("bead:closed", {
        id: beadId,
        title: "",
        closedAt: new Date().toISOString(),
      });
    } else {
      getEventBus().emit("bead:updated", {
        id: beadId,
        status,
        title: "",
        updatedAt: new Date().toISOString(),
      });
    }

    return {
      success: true,
      data: { id: beadId, status },
    };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "UPDATE_ERROR",
        message: err instanceof Error ? err.message : "Failed to update bead status",
      },
    };
  }
}

/**
 * Gets detailed information about a single bead.
 * @param beadId Full bead ID (e.g., "hq-vts8" or "adj-67tta")
 * @returns Result with bead details or error
 */
export async function getBead(
  beadId: string
): Promise<BeadsServiceResult<BeadDetail>> {
  try {
    // Build prefix map to determine which database to use
    await ensurePrefixMap();

    // Get the prefix from the bead ID
    const prefix = beadId.split("-")[0];
    if (!prefix) {
      return {
        success: false,
        error: {
          code: "INVALID_BEAD_ID",
          message: `Invalid bead ID format: ${beadId}`,
        },
      };
    }

    // Determine which database this bead belongs to
    const map = loadPrefixMap();
    const source = map.get(prefix) ?? "unknown";

    let workDir: string;
    let beadsDir: string;

    if (!source || source === "town" || source === "unknown") {
      // Town-level bead (hq-*) or unknown prefix - try town first
      const townRoot = resolveWorkspaceRoot();
      workDir = townRoot;
      beadsDir = resolveBeadsDir(townRoot);
    } else {
      // Rig-specific bead - find the rig path
      const beadsDirs = await listAllBeadsDirs();
      const rigDir = beadsDirs.find((d) => d.rig === source);
      if (!rigDir) {
        return {
          success: false,
          error: {
            code: "RIG_NOT_FOUND",
            message: `Cannot find rig database for prefix: ${prefix}`,
          },
        };
      }
      workDir = rigDir.workDir;
      beadsDir = rigDir.path;
    }

    // Execute bd show command with --json flag
    // bd show expects the full ID (e.g., "adj-c2g97"), not stripped
    const args = ["show", beadId, "--json"];

    // bd show returns an array of issues
    const result = await execBd<BeadsIssue[]>(args, { cwd: workDir, beadsDir });

    if (!result.success || !result.data || result.data.length === 0) {
      return {
        success: false,
        error: {
          code: result.error?.code ?? "BEAD_NOT_FOUND",
          message: result.error?.message ?? `Bead not found: ${beadId}`,
        },
      };
    }

    const issue = result.data[0];

    // Transform to BeadDetail
    const detail: BeadDetail = {
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
      closedAt: issue.closed_at ?? null,
      agentState: issue.agent_state ?? null,
      dependencies: (issue.dependencies ?? []).map((d) => ({
        issueId: d.issue_id,
        dependsOnId: d.depends_on_id,
        type: d.type,
      })),
      isWisp: issue.wisp ?? false,
      isPinned: issue.pinned ?? false,
    };

    return { success: true, data: detail };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "GET_BEAD_ERROR",
        message: err instanceof Error ? err.message : "Failed to get bead",
      },
    };
  }
}
