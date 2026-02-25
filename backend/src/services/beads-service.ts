/**
 * Beads service for listing beads from town level.
 * IMPORTANT: Adjutant is the dashboard for ALL of Gas Town.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { execBd, resolveBeadsDir, type BeadsIssue } from "./bd-client.js";
import { listAllBeadsDirs, resolveWorkspaceRoot, getDeploymentMode } from "./workspace/index.js";
import { getEventBus } from "./event-bus.js";
import { logInfo } from "../utils/index.js";
import type { BeadsGraphResponse, GraphDependency, GraphNode } from "../types/beads.js";

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

/**
 * Recently closed bead info for the widget/activity feed.
 */
export interface RecentlyClosedBead {
  id: string;
  title: string;
  assignee: string | null;
  closedAt: string;
  type: string;
  priority: number;
  rig: string | null;
  source: string;
}

export interface ListBeadsOptions {
  rig?: string;
  /** Path to rig's directory containing .beads/ - if provided, queries that rig's beads database */
  rigPath?: string;
  status?: string;
  type?: string;
  limit?: number;
  /** Filter beads by assignee (exact match on assignee field) */
  assignee?: string;
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
 *
 * NOTE: Epics cannot be closed directly. They auto-complete when all
 * sub-beads are closed (via `bd epic close-eligible`).
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
      if (prefix && !map.has(prefix)) {
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

/** Result from fetching beads from a single database. */
interface FetchResult {
  beads: BeadInfo[];
  /** Non-null if the fetch failed. Callers can decide whether to treat as fatal. */
  error?: { code: string; message: string };
}

/**
 * Fetches beads from a single database.
 * Returns partial results: beads may be empty on failure, with error set.
 * This allows callers to decide whether to propagate or tolerate the error.
 */
async function fetchBeadsFromDatabase(
  workDir: string,
  beadsDir: string,
  source: string,
  options: ListBeadsOptions
): Promise<FetchResult> {
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
  if (!result.success) {
    const errorCode = result.error?.code ?? "BD_EXEC_FAILED";
    const errorMsg = result.error?.message ?? "bd command failed";
    logInfo("fetchBeadsFromDatabase failed", { source, errorCode, errorMsg });
    return {
      beads: [],
      error: { code: errorCode, message: errorMsg },
    };
  }

  // Success but no data (empty database) - return empty beads, no error
  if (!result.data) {
    return { beads: [] };
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

  return { beads };
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

    const fetchResult = await fetchBeadsFromDatabase(workDir, beadsDir, source, options);

    // If the single-database fetch failed, propagate the error
    if (fetchResult.error) {
      return {
        success: false,
        error: {
          code: fetchResult.error.code,
          message: fetchResult.error.message,
        },
      };
    }

    let beads = fetchResult.beads;

    // Filter by rig if specified AND we're not already querying a rig-specific database.
    if (options.rig && !options.rigPath) {
      beads = beads.filter((b) => b.rig === options.rig);
    }

    // Filter by assignee if specified
    if (options.assignee) {
      const target = options.assignee.toLowerCase();
      beads = beads.filter((b) => {
        if (!b.assignee) return false;
        const a = b.assignee.toLowerCase();
        if (a === target) return true;
        // Match last path component: "rig/polecats/toast" matches "toast"
        const lastComponent = a.split("/").pop();
        return lastComponent === target;
      });
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

    // Fetch from all databases sequentially (serialized through bd semaphore
    // to prevent concurrent SQLite access that causes SIGSEGV).
    // Even though the semaphore serializes at the execBd level, we collect
    // results and track per-database errors for better diagnostics.
    const fetchResults: FetchResult[] = [];
    const errors: Array<{ source: string; error: { code: string; message: string } }> = [];

    for (const db of databasesToQuery) {
      const result = await fetchBeadsFromDatabase(db.workDir, db.beadsDir, db.source, options);
      fetchResults.push(result);
      if (result.error) {
        errors.push({ source: db.source, error: result.error });
      }
    }

    // If ALL databases failed, return an error
    if (errors.length === databasesToQuery.length && databasesToQuery.length > 0) {
      const firstError = errors[0]!;
      return {
        success: false,
        error: {
          code: firstError.error.code,
          message: `All bead databases failed. First error: ${firstError.error.message}`,
        },
      };
    }

    // Log partial failures but continue with successful results
    if (errors.length > 0) {
      logInfo("listAllBeads partial failure", {
        totalDbs: databasesToQuery.length,
        failedDbs: errors.length,
        errors: errors.map((e) => `${e.source}: ${e.error.message}`),
      });
    }

    let allBeads = fetchResults.flatMap((r) => r.beads);

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

    // Filter by assignee if specified
    if (options.assignee) {
      const target = options.assignee.toLowerCase();
      allBeads = allBeads.filter((b) => {
        if (!b.assignee) return false;
        const a = b.assignee.toLowerCase();
        if (a === target) return true;
        const lastComponent = a.split("/").pop();
        return lastComponent === target;
      });
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
 * Resolves the working directory and beads directory for a given bead ID.
 * Used by updateBeadStatus and other functions that need to route to the correct database.
 */
async function resolveBeadDatabase(beadId: string): Promise<
  | { workDir: string; beadsDir: string }
  | { error: { code: string; message: string } }
> {
  await ensurePrefixMap();

  const prefix = beadId.split("-")[0];
  if (!prefix) {
    return { error: { code: "INVALID_BEAD_ID", message: `Invalid bead ID format: ${beadId}` } };
  }

  const map = loadPrefixMap();
  const source = map.get(prefix);

  if (!source || source === "town") {
    const townRoot = resolveWorkspaceRoot();
    return { workDir: townRoot, beadsDir: resolveBeadsDir(townRoot) };
  }

  const beadsDirs = await listAllBeadsDirs();
  const rigDir = beadsDirs.find((d) => d.rig === source);
  if (!rigDir) {
    return { error: { code: "RIG_NOT_FOUND", message: `Cannot find rig database for prefix: ${prefix}` } };
  }
  return { workDir: rigDir.workDir, beadsDir: rigDir.path };
}

/**
 * Checks if a bead is an epic by looking up its type.
 * Returns true if the bead is type "epic", false otherwise.
 */
export async function isBeadEpic(
  beadId: string,
  dbInfo?: { workDir: string; beadsDir: string }
): Promise<boolean> {
  const db = dbInfo ?? await resolveBeadDatabase(beadId);
  if ("error" in db) return false;

  const result = await execBd<BeadsIssue[]>(["show", beadId, "--json"], {
    cwd: db.workDir,
    beadsDir: db.beadsDir,
  });

  if (!result.success || !result.data || result.data.length === 0) return false;
  return result.data[0]?.issue_type === "epic";
}

/**
 * Runs `bd epic close-eligible` to auto-close epics whose children are all done.
 * Called after any task/bug is closed to propagate completion up the hierarchy.
 *
 * @returns Array of auto-closed epic IDs (may be empty)
 */
export async function autoCompleteEpics(
  workDir: string,
  beadsDir: string
): Promise<string[]> {
  const result = await execBd<Array<{ id: string; title?: string }>>(
    ["epic", "close-eligible", "--json"],
    { cwd: workDir, beadsDir }
  );

  if (!result.success || !result.data) return [];

  // Emit events for any auto-closed epics
  const closedIds: string[] = [];
  for (const epic of result.data) {
    const epicId = typeof epic === "string" ? epic : epic.id;
    if (epicId) {
      closedIds.push(epicId);
      getEventBus().emit("bead:closed", {
        id: epicId,
        title: typeof epic === "object" ? (epic.title ?? "") : "",
        closedAt: new Date().toISOString(),
      });
      logInfo("epic auto-completed", { epicId });
    }
  }

  return closedIds;
}

/**
 * Options for updating a bead. At least one field must be provided.
 */
export interface UpdateBeadOptions {
  status?: BeadStatus;
  assignee?: string;
}

/**
 * Updates a bead's fields (status, assignee, or both).
 *
 * NOTE: Epics cannot be set to "closed" directly. They auto-complete
 * when all sub-beads are closed (via `bd epic close-eligible`).
 *
 * @param beadId Full bead ID (e.g., "hq-vts8" or "gb-53tj")
 * @param options Fields to update (status, assignee)
 * @returns Result with success/error info
 */
export async function updateBead(
  beadId: string,
  options: UpdateBeadOptions
): Promise<BeadsServiceResult<{ id: string; status?: string; assignee?: string; autoCompleted?: string[] }>> {
  try {
    const { status, assignee } = options;

    // Validate that at least one field is provided
    if (!status && assignee === undefined) {
      return {
        success: false,
        error: {
          code: "INVALID_REQUEST",
          message: "At least one of 'status' or 'assignee' must be provided",
        },
      };
    }

    // Validate status if provided
    if (status && !ALL_STATUSES.includes(status)) {
      return {
        success: false,
        error: {
          code: "INVALID_STATUS",
          message: `Invalid status: ${status}. Valid values: ${ALL_STATUSES.join(", ")}`,
        },
      };
    }

    const db = await resolveBeadDatabase(beadId);
    if ("error" in db) {
      return { success: false, error: db.error };
    }

    // Guard: epics cannot be closed directly — they auto-complete
    if (status === "closed") {
      const epic = await isBeadEpic(beadId, db);
      if (epic) {
        return {
          success: false,
          error: {
            code: "EPIC_CLOSE_BLOCKED",
            message: `Epics cannot be closed directly. Epic ${beadId} will auto-complete when all its sub-beads are closed.`,
          },
        };
      }
    }

    // Build bd update command args dynamically
    const shortId = beadId.includes("-") ? beadId.split("-").slice(1).join("-") : beadId;
    const args = ["update", shortId];

    if (status) {
      args.push("--status", status);
    }
    if (assignee !== undefined) {
      args.push("--assignee", assignee);
    }

    const result = await execBd<void>(args, { cwd: db.workDir, beadsDir: db.beadsDir, parseJson: false });

    if (!result.success) {
      return {
        success: false,
        error: {
          code: result.error?.code ?? "UPDATE_FAILED",
          message: result.error?.message ?? "Failed to update bead",
        },
      };
    }

    // Emit bead event for SSE/WebSocket consumers
    if (status === "closed") {
      getEventBus().emit("bead:closed", {
        id: beadId,
        title: "",
        closedAt: new Date().toISOString(),
      });
    } else {
      getEventBus().emit("bead:updated", {
        id: beadId,
        status: status ?? "",
        title: "",
        updatedAt: new Date().toISOString(),
        ...(assignee !== undefined ? { assignee } : {}),
      });
    }

    // After closing a non-epic bead, auto-complete any eligible parent epics
    let autoCompleted: string[] = [];
    if (status === "closed") {
      autoCompleted = await autoCompleteEpics(db.workDir, db.beadsDir);
    }

    const responseData: { id: string; status?: string; assignee?: string; autoCompleted?: string[] } = { id: beadId };
    if (status) responseData.status = status;
    if (assignee !== undefined) responseData.assignee = assignee;
    if (autoCompleted.length > 0) responseData.autoCompleted = autoCompleted;

    return { success: true, data: responseData };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "UPDATE_ERROR",
        message: err instanceof Error ? err.message : "Failed to update bead",
      },
    };
  }
}

/**
 * Updates a bead's status. Backward-compatible wrapper around updateBead().
 *
 * @param beadId Full bead ID (e.g., "hq-vts8" or "gb-53tj")
 * @param status New status value
 * @returns Result with success/error info
 */
export async function updateBeadStatus(
  beadId: string,
  status: BeadStatus
): Promise<BeadsServiceResult<{ id: string; status: string; autoCompleted?: string[] }>> {
  const result = await updateBead(beadId, { status });
  if (!result.success) return result as BeadsServiceResult<{ id: string; status: string; autoCompleted?: string[] }>;

  // Ensure status is always present in the backward-compatible response
  return {
    success: true,
    data: {
      id: result.data!.id,
      status: result.data!.status ?? status,
      ...(result.data!.autoCompleted ? { autoCompleted: result.data!.autoCompleted } : {}),
    },
  };
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
    if (!issue) {
      return {
        success: false,
        error: {
          code: "BEAD_NOT_FOUND",
          message: `Bead not found: ${beadId}`,
        },
      };
    }

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

// ============================================================================
// Epic Children (Dependency Graph)
// ============================================================================

/**
 * Gets all children of an epic using the dependency graph (`bd children`).
 * This is the correct way to find sub-beads — uses deps, not naming conventions.
 *
 * @param epicId Full epic bead ID (e.g., "adj-020")
 * @returns Array of child BeadInfo objects
 */
export async function getEpicChildren(
  epicId: string
): Promise<BeadsServiceResult<BeadInfo[]>> {
  try {
    await ensurePrefixMap();

    // Determine which database this epic belongs to
    const prefix = epicId.split("-")[0];
    if (!prefix) {
      return {
        success: false,
        error: { code: "INVALID_BEAD_ID", message: `Invalid bead ID format: ${epicId}` },
      };
    }

    const map = loadPrefixMap();
    const source = map.get(prefix) ?? "unknown";

    let workDir: string;
    let beadsDir: string;

    if (!source || source === "town" || source === "unknown") {
      const townRoot = resolveWorkspaceRoot();
      workDir = townRoot;
      beadsDir = resolveBeadsDir(townRoot);
    } else {
      const beadsDirs = await listAllBeadsDirs();
      const rigDir = beadsDirs.find((d) => d.rig === source);
      if (!rigDir) {
        return {
          success: false,
          error: { code: "RIG_NOT_FOUND", message: `Cannot find rig database for prefix: ${prefix}` },
        };
      }
      workDir = rigDir.workDir;
      beadsDir = rigDir.path;
    }

    // Use `bd children <epicId> --json` to get all children via dependency graph
    const result = await execBd<BeadsIssue[]>(
      ["children", epicId, "--json"],
      { cwd: workDir, beadsDir }
    );

    if (!result.success) {
      return {
        success: false,
        error: {
          code: result.error?.code ?? "CHILDREN_FETCH_ERROR",
          message: result.error?.message ?? `Failed to fetch children for: ${epicId}`,
        },
      };
    }

    if (!result.data || result.data.length === 0) {
      return { success: true, data: [] };
    }

    // Filter out wisps and transform to BeadInfo
    const children = result.data
      .filter((issue) => !issue.wisp && !issue.id.includes("-wisp-"))
      .map((issue) => transformBead(issue, source));

    // Sort by priority then by updatedAt
    children.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const aDate = a.updatedAt ?? a.createdAt;
      const bDate = b.updatedAt ?? b.createdAt;
      return bDate.localeCompare(aDate);
    });

    return { success: true, data: children };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "EPIC_CHILDREN_ERROR",
        message: err instanceof Error ? err.message : "Failed to get epic children",
      },
    };
  }
}

/**
 * Epic with progress info computed server-side using dependency graph.
 */
export interface EpicWithChildren {
  epic: BeadInfo;
  children: BeadInfo[];
  totalCount: number;
  closedCount: number;
  progress: number;
}

/**
 * Gets all epics with their progress computed server-side.
 * Uses `bd show` per epic to get dependency data (children with status).
 * Much more efficient than having the frontend fetch all 600+ beads.
 */
export async function listEpicsWithProgress(
  options: { rig?: string; status?: string } = {}
): Promise<BeadsServiceResult<EpicWithChildren[]>> {
  try {
    await ensurePrefixMap();
    const townRoot = resolveWorkspaceRoot();
    const townBeadsDir = resolveBeadsDir(townRoot);

    // Fetch epics from town database
    const listArgs = ["list", "--json", "--type", "epic", "--all"];
    const epicResult = await execBd<BeadsIssue[]>(listArgs, {
      cwd: townRoot,
      beadsDir: townBeadsDir,
    });

    if (!epicResult.success || !epicResult.data) {
      return { success: true, data: [] };
    }

    // Also fetch from rig databases
    const beadsDirs = await listAllBeadsDirs();
    const rigDirs = beadsDirs.filter((d) => d.rig !== null);

    const allEpicIssues = [...epicResult.data];
    for (const rigDir of rigDirs) {
      const rigResult = await execBd<BeadsIssue[]>(listArgs, {
        cwd: rigDir.workDir,
        beadsDir: rigDir.path,
      });
      if (rigResult.success && rigResult.data) {
        allEpicIssues.push(...rigResult.data);
      }
    }

    // Filter by status if requested
    const statusFilter = options.status;
    let filteredEpics = allEpicIssues.filter((e) => !e.wisp);
    if (statusFilter && statusFilter !== "all") {
      filteredEpics = filteredEpics.filter((e) => e.status === statusFilter);
    }

    // Build a map of epicId -> {workDir, beadsDir} for bd show lookups
    const epicDbMap = new Map<string, { workDir: string; beadsDir: string }>();
    for (const epic of filteredEpics) {
      const prefix = epic.id.split("-")[0];
      if (!prefix) continue;
      const map = loadPrefixMap();
      const source = map.get(prefix) ?? "town";
      if (source === "town" || source === "unknown") {
        epicDbMap.set(epic.id, { workDir: townRoot, beadsDir: townBeadsDir });
      } else {
        const rigDir = rigDirs.find((d) => d.rig === source);
        if (rigDir) {
          epicDbMap.set(epic.id, { workDir: rigDir.workDir, beadsDir: rigDir.path });
        } else {
          epicDbMap.set(epic.id, { workDir: townRoot, beadsDir: townBeadsDir });
        }
      }
    }

    // For each epic, use `bd show` to get dependencies with status
    // bd show returns children as full objects in the dependencies array
    const results: EpicWithChildren[] = [];
    for (const epic of filteredEpics) {
      const source = prefixToSource(epic.id);
      const epicInfo = transformBead(epic, source);
      const db = epicDbMap.get(epic.id);

      if (!db) {
        results.push({ epic: epicInfo, children: [], totalCount: 0, closedCount: 0, progress: 0 });
        continue;
      }

      const showResult = await execBd<BeadsIssue[]>(
        ["show", epic.id, "--json"],
        { cwd: db.workDir, beadsDir: db.beadsDir }
      );

      if (!showResult.success || !showResult.data || showResult.data.length === 0) {
        results.push({ epic: epicInfo, children: [], totalCount: 0, closedCount: 0, progress: 0 });
        continue;
      }

      // bd show returns deps as full objects with status
      const detail = showResult.data[0]!;
      const deps = detail.dependencies ?? [];

      // Children are deps where issue_id matches this epic
      const childDeps = deps.filter((d) => d.issue_id === epic.id);
      const totalCount = childDeps.length;
      const closedCount = childDeps.filter((d) => d.depends_on_id).reduce((count, dep) => {
        // The dep object in bd show output is actually a full issue object
        // with a dependency_type field added. Check status field directly.
        const depAsRecord = dep as Record<string, unknown>;
        return count + (depAsRecord["status"] === "closed" ? 1 : 0);
      }, 0);
      const progress = totalCount > 0 ? closedCount / totalCount : 0;

      results.push({
        epic: epicInfo,
        children: [], // Don't include full children in list view
        totalCount,
        closedCount,
        progress,
      });
    }

    // Sort by updatedAt descending
    results.sort((a, b) => {
      const aTime = a.epic.updatedAt ?? a.epic.createdAt;
      const bTime = b.epic.updatedAt ?? b.epic.createdAt;
      return bTime.localeCompare(aTime);
    });

    return { success: true, data: results };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "EPICS_PROGRESS_ERROR",
        message: err instanceof Error ? err.message : "Failed to list epics with progress",
      },
    };
  }
}

// ============================================================================
// Bead Sources
// ============================================================================

/**
 * A bead source represents a project/rig directory that contains beads.
 */
export interface BeadSource {
  /** Display name (rig name or "project") */
  name: string;
  /** Absolute path to the working directory */
  path: string;
  /** Whether this directory has beads */
  hasBeads: boolean;
}

/**
 * Lists all available bead sources (projects/rigs with beads databases).
 * Used by the frontend to populate filter dropdowns in any deployment mode.
 */
export async function listBeadSources(): Promise<
  BeadsServiceResult<{ sources: BeadSource[]; mode: string }>
> {
  try {
    const beadsDirs = await listAllBeadsDirs();
    const mode = getDeploymentMode();

    const sources: BeadSource[] = beadsDirs.map((dirInfo) => ({
      name: dirInfo.rig ?? "project",
      path: dirInfo.workDir,
      hasBeads: true,
    }));

    return { success: true, data: { sources, mode } };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "SOURCES_ERROR",
        message: err instanceof Error ? err.message : "Failed to list bead sources",
      },
    };
  }
}

// ============================================================================
// Recently Closed Beads
// ============================================================================

/**
 * Max number of recently closed beads to return.
 */
const RECENT_CLOSED_LIMIT = 10;

/**
 * Lists beads closed within a configurable time window.
 * Queries all databases (town + rigs), filters by closed_at timestamp,
 * and excludes wisps/system beads (same OVERSEER scope as listAllBeads).
 *
 * @param hours Time window in hours (1-24, default 1)
 * @returns Recently closed beads sorted by closedAt descending
 */
export async function listRecentlyClosed(
  hours: number = 1
): Promise<BeadsServiceResult<RecentlyClosedBead[]>> {
  try {
    await ensurePrefixMap();

    const townRoot = resolveWorkspaceRoot();
    const beadsDirs = await listAllBeadsDirs();

    // Build list of all databases to query (same pattern as listAllBeads)
    const townBeadsDir = join(townRoot, ".beads");
    const databasesToQuery: Array<{ workDir: string; beadsDir: string; source: string }> = [
      { workDir: townRoot, beadsDir: townBeadsDir, source: "town" },
    ];

    const rigDirs = beadsDirs.filter((dirInfo) => dirInfo.rig !== null);
    for (const dirInfo of rigDirs) {
      databasesToQuery.push({
        workDir: dirInfo.workDir,
        beadsDir: dirInfo.path,
        source: dirInfo.rig!,
      });
    }

    // Calculate the cutoff timestamp
    const cutoffMs = Date.now() - hours * 3600 * 1000;

    // Fetch closed beads from all databases sequentially (bd semaphore serializes)
    const allClosed: RecentlyClosedBead[] = [];

    for (const db of databasesToQuery) {
      const result = await execBd<BeadsIssue[]>(
        ["list", "--all", "--status", "closed", "--json"],
        { cwd: db.workDir, beadsDir: db.beadsDir }
      );

      if (!result.success || !result.data) continue;

      for (const issue of result.data) {
        // Filter out wisps (same as fetchBeadsFromDatabase)
        if (issue.wisp) continue;
        if (issue.id.includes("-wisp-")) continue;

        // Must have a closed_at timestamp
        if (!issue.closed_at) continue;

        // Parse closed_at and check against the time window
        const closedTime = new Date(issue.closed_at).getTime();
        if (isNaN(closedTime) || closedTime < cutoffMs) continue;

        allClosed.push({
          id: issue.id,
          title: issue.title,
          assignee: issue.assignee ?? null,
          closedAt: issue.closed_at,
          type: issue.issue_type,
          priority: issue.priority,
          rig: extractRig(issue.assignee),
          source: prefixToSource(issue.id),
        });
      }
    }

    // Deduplicate by bead ID (same bead may exist in multiple databases)
    const seenIds = new Set<string>();
    const deduplicated = allClosed.filter((b) => {
      if (seenIds.has(b.id)) return false;
      seenIds.add(b.id);
      return true;
    });

    // Sort by closedAt descending (most recent first)
    deduplicated.sort((a, b) => {
      return new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime();
    });

    // Limit to max results
    const limited = deduplicated.slice(0, RECENT_CLOSED_LIMIT);

    return { success: true, data: limited };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "RECENT_CLOSED_ERROR",
        message: err instanceof Error ? err.message : "Failed to list recently closed beads",
      },
    };
  }
}

// ============================================================================
// Project Overview (adj-020)
// ============================================================================

/**
 * Epic progress info for the project overview.
 */
export interface EpicProgress {
  id: string;
  title: string;
  status: string;
  totalChildren: number;
  closedChildren: number;
  completionPercent: number;
  assignee: string | null;
}

/**
 * Project overview data aggregated from beads.
 */
export interface ProjectBeadsOverview {
  open: BeadInfo[];
  inProgress: BeadInfo[];
  recentlyClosed: BeadInfo[];
}

/**
 * Gets a project-scoped beads overview: open, in-progress, and recently closed beads.
 *
 * @param projectPath Absolute path to the project directory
 * @returns Beads grouped by status
 */
export async function getProjectOverview(
  projectPath: string
): Promise<BeadsServiceResult<ProjectBeadsOverview>> {
  try {
    const beadsDir = resolveBeadsDir(projectPath);

    // Fetch open beads
    const openResult = await execBd<BeadsIssue[]>(
      ["list", "--json", "--status", "open"],
      { cwd: projectPath, beadsDir }
    );

    // Fetch in-progress, hooked, and blocked beads (all active work statuses)
    const inProgressResult = await execBd<BeadsIssue[]>(
      ["list", "--json", "--status", "in_progress"],
      { cwd: projectPath, beadsDir }
    );
    const hookedResult = await execBd<BeadsIssue[]>(
      ["list", "--json", "--status", "hooked"],
      { cwd: projectPath, beadsDir }
    );
    const blockedResult = await execBd<BeadsIssue[]>(
      ["list", "--json", "--status", "blocked"],
      { cwd: projectPath, beadsDir }
    );

    // Fetch closed beads for recently-closed (last 24h)
    const closedResult = await execBd<BeadsIssue[]>(
      ["list", "--all", "--json", "--status", "closed"],
      { cwd: projectPath, beadsDir }
    );

    const cutoff24h = Date.now() - 24 * 3600 * 1000;

    const filterWisps = (issues: BeadsIssue[]): BeadsIssue[] =>
      issues.filter((i) => !i.wisp && !i.id.includes("-wisp-"));

    const openBeads = (openResult.success && openResult.data)
      ? filterWisps(openResult.data).map((i) => transformBead(i, "project"))
      : [];

    // Merge in_progress + hooked + blocked into a single list
    const activeIssues: BeadsIssue[] = [
      ...((inProgressResult.success && inProgressResult.data) ? inProgressResult.data : []),
      ...((hookedResult.success && hookedResult.data) ? hookedResult.data : []),
      ...((blockedResult.success && blockedResult.data) ? blockedResult.data : []),
    ];
    const inProgressBeads = filterWisps(activeIssues).map((i) => transformBead(i, "project"));

    const recentlyClosedBeads = (closedResult.success && closedResult.data)
      ? filterWisps(closedResult.data)
          .filter((i) => {
            if (!i.closed_at) return false;
            const closedTime = new Date(i.closed_at).getTime();
            return !isNaN(closedTime) && closedTime >= cutoff24h;
          })
          .map((i) => transformBead(i, "project"))
          .sort((a, b) => {
            const aDate = a.updatedAt ?? a.createdAt;
            const bDate = b.updatedAt ?? b.createdAt;
            return bDate.localeCompare(aDate);
          })
      : [];

    return {
      success: true,
      data: {
        open: openBeads,
        inProgress: inProgressBeads,
        recentlyClosed: recentlyClosedBeads,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "PROJECT_OVERVIEW_ERROR",
        message: err instanceof Error ? err.message : "Failed to get project overview",
      },
    };
  }
}

/**
 * Computes epic progress for a project.
 * Lists all open/in-progress epics, then counts closed vs total children.
 *
 * @param projectPath Absolute path to the project directory
 * @returns EpicProgress[] sorted by completion % descending
 */
export async function computeEpicProgress(
  projectPath: string
): Promise<BeadsServiceResult<EpicProgress[]>> {
  try {
    const beadsDir = resolveBeadsDir(projectPath);

    // List open and in-progress epics
    const epicsResult = await execBd<BeadsIssue[]>(
      ["list", "--json", "--type", "epic", "--all"],
      { cwd: projectPath, beadsDir }
    );

    if (!epicsResult.success || !epicsResult.data) {
      return { success: true, data: [] };
    }

    // Filter to open/in_progress epics only
    const activeEpics = epicsResult.data.filter(
      (e) => e.status === "open" || e.status === "in_progress"
    );

    // Batch: fetch all beads once to build a status lookup map.
    // This avoids O(n*m) individual `bd show` calls for child status checks.
    const allBeadsResult = await execBd<BeadsIssue[]>(
      ["list", "--all", "--json"],
      { cwd: projectPath, beadsDir }
    );
    const statusMap = new Map<string, string>();
    if (allBeadsResult.success && allBeadsResult.data) {
      for (const bead of allBeadsResult.data) {
        statusMap.set(bead.id, bead.status);
      }
    }

    const progress: EpicProgress[] = [];

    for (const epic of activeEpics) {
      // Get epic details including dependencies (children)
      const showResult = await execBd<BeadsIssue[]>(
        ["show", epic.id, "--json"],
        { cwd: projectPath, beadsDir }
      );

      if (!showResult.success || !showResult.data || showResult.data.length === 0) {
        progress.push({
          id: epic.id,
          title: epic.title,
          status: epic.status,
          totalChildren: 0,
          closedChildren: 0,
          completionPercent: 0,
          assignee: epic.assignee ?? null,
        });
        continue;
      }

      const detail = showResult.data[0]!;
      const deps = detail.dependencies ?? [];
      // In bd dependency model: if epic depends on child,
      // then issue_id=epic.id and depends_on_id=child.id
      const childIds = deps
        .filter((d) => d.issue_id === epic.id)
        .map((d) => d.depends_on_id);

      // Count closed children using the pre-fetched status map
      const closedCount = childIds.filter((id) => statusMap.get(id) === "closed").length;
      const total = childIds.length;
      const pct = total > 0 ? closedCount / total : 0;

      progress.push({
        id: epic.id,
        title: epic.title,
        status: epic.status,
        totalChildren: total,
        closedChildren: closedCount,
        completionPercent: pct,
        assignee: epic.assignee ?? null,
      });
    }

    // Sort by completion % descending
    progress.sort((a, b) => b.completionPercent - a.completionPercent);

    return { success: true, data: progress };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "EPIC_PROGRESS_ERROR",
        message: err instanceof Error ? err.message : "Failed to compute epic progress",
      },
    };
  }
}

/**
 * Gets recently completed epics for empty-state fallback.
 *
 * @param projectPath Absolute path to the project directory
 * @param limit Max number of epics to return
 * @returns Closed epics sorted by closedAt descending
 */
export async function getRecentlyCompletedEpics(
  projectPath: string,
  limit: number = 5
): Promise<BeadsServiceResult<EpicProgress[]>> {
  try {
    const beadsDir = resolveBeadsDir(projectPath);

    const result = await execBd<BeadsIssue[]>(
      ["list", "--json", "--type", "epic", "--status", "closed"],
      { cwd: projectPath, beadsDir }
    );

    if (!result.success || !result.data) {
      return { success: true, data: [] };
    }

    const epics = result.data
      .filter((e) => e.closed_at)
      .sort((a, b) => {
        const aTime = new Date(a.closed_at!).getTime();
        const bTime = new Date(b.closed_at!).getTime();
        return bTime - aTime;
      })
      .slice(0, limit)
      .map((e): EpicProgress => ({
        id: e.id,
        title: e.title,
        status: e.status,
        totalChildren: 0,
        closedChildren: 0,
        completionPercent: 1.0,
        assignee: e.assignee ?? null,
      }));

    return { success: true, data: epics };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "RECENT_EPICS_ERROR",
        message: err instanceof Error ? err.message : "Failed to get recently completed epics",
      },
    };
  }
}

// ============================================================================
// Beads Dependency Graph (018-bead-dep-graph)
// ============================================================================

/**
 * Options for querying the beads dependency graph.
 * Mirrors the query params from GET /api/beads/graph.
 */
export interface BeadsGraphOptions {
  /** Which database(s) to query: "town" (default), "all", or a specific rig name */
  rig?: string | undefined;
  /** Status filter: "default", "all", or specific status(es) */
  status?: string | undefined;
  /** Filter by bead type (e.g., "epic", "task", "bug") */
  type?: string | undefined;
  /** Filter to a specific epic's sub-tree (client-side hint) */
  epicId?: string | undefined;
  /** Exclude hq-* town beads when rig=all */
  excludeTown?: boolean | undefined;
}

/**
 * Fetches beads from a single database with verbose output (includes dependencies).
 * Returns raw issues with dependency data for graph building.
 */
async function fetchGraphBeadsFromDatabase(
  workDir: string,
  beadsDir: string,
  options: BeadsGraphOptions
): Promise<{ issues: BeadsIssue[]; error?: { code: string; message: string } }> {
  const args = ["list", "--json", "-v"];

  const statusesToInclude = parseStatusFilter(options.status);
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

  const result = await execBd<BeadsIssue[]>(args, { cwd: workDir, beadsDir });
  if (!result.success) {
    return {
      issues: [],
      error: {
        code: result.error?.code ?? "BD_EXEC_FAILED",
        message: result.error?.message ?? "bd command failed",
      },
    };
  }

  if (!result.data) {
    return { issues: [] };
  }

  // Filter out wisps (same logic as fetchBeadsFromDatabase)
  let issues = result.data.filter((issue) => {
    if (issue.wisp) return false;
    if (issue.id.includes("-wisp-")) return false;
    return true;
  });

  // Client-side status filtering for multi-status presets (e.g., "default")
  if (statusesToInclude !== null && statusesToInclude.length > 1) {
    issues = issues.filter((issue) =>
      statusesToInclude.includes(issue.status.toLowerCase() as BeadStatus)
    );
  }

  return { issues };
}

/**
 * Builds a dependency graph of all beads for visualization.
 *
 * Fetches beads with verbose output (includes dependencies) from one or more
 * databases based on options. Deduplicates both nodes and edges. Wisps are
 * filtered out.
 *
 * NOTE: Uses `-v` (verbose) flag on `bd list` to include the `dependencies`
 * array in output. Without this flag, `bd list` omits dependency data.
 *
 * @param options Query options for filtering (rig, status, type, epicId, excludeTown)
 * @returns { nodes, edges } suitable for graph rendering
 */
export async function getBeadsGraph(
  options: BeadsGraphOptions = {}
): Promise<BeadsServiceResult<BeadsGraphResponse>> {
  try {
    await ensurePrefixMap();

    const townRoot = resolveWorkspaceRoot();
    const rig = options.rig?.trim() || "town";

    // Determine which databases to query
    const databasesToQuery: Array<{ workDir: string; beadsDir: string; source: string }> = [];

    if (rig === "all") {
      // Query town + all discovered rig databases (same as listAllBeads)
      const townBeadsDir = join(townRoot, ".beads");
      databasesToQuery.push({ workDir: townRoot, beadsDir: townBeadsDir, source: "town" });

      const beadsDirs = await listAllBeadsDirs();
      const rigDirs = beadsDirs.filter((dirInfo) => dirInfo.rig !== null);
      for (const dirInfo of rigDirs) {
        databasesToQuery.push({
          workDir: dirInfo.workDir,
          beadsDir: dirInfo.path,
          source: dirInfo.rig!,
        });
      }
    } else if (rig === "town") {
      // Only town database
      const townBeadsDir = resolveBeadsDir(townRoot);
      databasesToQuery.push({ workDir: townRoot, beadsDir: townBeadsDir, source: "town" });
    } else {
      // Specific rig - try to find its database
      const beadsDirs = await listAllBeadsDirs();
      const rigDir = beadsDirs.find((d) => d.rig === rig);
      if (rigDir) {
        databasesToQuery.push({
          workDir: rigDir.workDir,
          beadsDir: rigDir.path,
          source: rigDir.rig!,
        });
      } else {
        // Fallback: try town database if rig not found
        const townBeadsDir = resolveBeadsDir(townRoot);
        databasesToQuery.push({ workDir: townRoot, beadsDir: townBeadsDir, source: "town" });
      }
    }

    // Fetch from all databases sequentially (bd semaphore serializes)
    const allIssues: BeadsIssue[] = [];
    const errors: Array<{ source: string; error: { code: string; message: string } }> = [];

    for (const db of databasesToQuery) {
      const fetchResult = await fetchGraphBeadsFromDatabase(db.workDir, db.beadsDir, options);
      if (fetchResult.error) {
        errors.push({ source: db.source, error: fetchResult.error });
      }
      allIssues.push(...fetchResult.issues);
    }

    // If ALL databases failed, return the first error
    if (errors.length === databasesToQuery.length && databasesToQuery.length > 0) {
      const firstError = errors[0]!;
      return {
        success: false,
        error: {
          code: firstError.error.code,
          message: firstError.error.message,
        },
      };
    }

    // Deduplicate issues by bead ID (same bead may exist in multiple databases)
    const seenIds = new Set<string>();
    const uniqueIssues = allIssues.filter((issue) => {
      if (seenIds.has(issue.id)) return false;
      seenIds.add(issue.id);
      return true;
    });

    // Filter out excluded prefixes when excludeTown is set
    let issues = uniqueIssues;
    if (options.excludeTown && rig === "all") {
      issues = issues.filter((issue) => !issue.id.startsWith("hq-"));
    }

    // Build nodes from beads
    const nodes: GraphNode[] = issues.map((issue) => ({
      id: issue.id,
      title: issue.title,
      status: issue.status,
      type: issue.issue_type,
      priority: issue.priority,
      assignee: issue.assignee ?? null,
      source: prefixToSource(issue.id),
    }));

    // Extract edges from dependency data across all beads, with deduplication.
    // Bidirectional deps (A->B on bead A and B->A on bead B) or duplicate entries
    // across multiple databases must be deduplicated to prevent rendering duplicate edges.
    const edgeKeys = new Set<string>();
    const edges: GraphDependency[] = [];
    for (const issue of issues) {
      if (issue.dependencies) {
        for (const dep of issue.dependencies) {
          const key = `${dep.issue_id}->${dep.depends_on_id}`;
          if (!edgeKeys.has(key)) {
            edgeKeys.add(key);
            edges.push({
              issueId: dep.issue_id,
              dependsOnId: dep.depends_on_id,
              type: dep.type,
            });
          }
        }
      }
    }

    return { success: true, data: { nodes, edges } };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "GRAPH_ERROR",
        message: err instanceof Error ? err.message : "Failed to build beads graph",
      },
    };
  }
}
