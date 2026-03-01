/**
 * Database resolution and fetching for beads.
 *
 * Routes bead operations to the correct database based on bead ID prefix.
 * Provides the data-fetching layer used by query and mutation modules.
 */

import { join } from "path";

import { execBd, resolveBeadsDir, type BeadsIssue } from "../bd-client.js";
import { listAllBeadsDirs, resolveWorkspaceRoot } from "../workspace/index.js";
import { logInfo } from "../../utils/index.js";
import type {
  BeadSource,
  BeadStatus,
  BeadsServiceResult,
  ListBeadsOptions,
  BeadsGraphOptions,
  FetchResult,
} from "./types.js";
import { VALID_SORT_FIELDS } from "./types.js";
import { ensurePrefixMap, loadPrefixMap } from "./beads-prefix-map.js";
import { transformBead } from "./beads-transform.js";
import { parseStatusFilter, excludeWisps } from "./beads-filter.js";

// ============================================================================
// Database Resolution
// ============================================================================

/**
 * Resolves the working directory and beads directory for a given bead ID.
 * Used by mutations, epics, and query functions that need to route to the correct database.
 */
export async function resolveBeadDatabase(beadId: string): Promise<
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

// ============================================================================
// Database List Building
// ============================================================================

/**
 * Builds a list of databases to query based on rig filter.
 * Replaces the repeated town+rigs aggregation pattern in listAllBeads,
 * listRecentlyClosed, and getBeadsGraph.
 *
 * @param rig "all" for town + all rigs, "town" for town only, or a specific rig name
 */
export async function buildDatabaseList(
  rig?: string
): Promise<Array<{ workDir: string; beadsDir: string; source: string }>> {
  const townRoot = resolveWorkspaceRoot();
  const effectiveRig = rig?.trim() || "town";

  if (effectiveRig === "all") {
    const townBeadsDir = join(townRoot, ".beads");
    const databases: Array<{ workDir: string; beadsDir: string; source: string }> = [
      { workDir: townRoot, beadsDir: townBeadsDir, source: "town" },
    ];

    const beadsDirs = await listAllBeadsDirs();
    for (const dirInfo of beadsDirs.filter((d) => d.rig !== null)) {
      databases.push({
        workDir: dirInfo.workDir,
        beadsDir: dirInfo.path,
        source: dirInfo.rig!,
      });
    }
    return databases;
  }

  if (effectiveRig === "town") {
    const townBeadsDir = resolveBeadsDir(townRoot);
    return [{ workDir: townRoot, beadsDir: townBeadsDir, source: "town" }];
  }

  // Specific rig
  const beadsDirs = await listAllBeadsDirs();
  const rigDir = beadsDirs.find((d) => d.rig === effectiveRig);
  if (rigDir) {
    return [{
      workDir: rigDir.workDir,
      beadsDir: rigDir.path,
      source: rigDir.rig!,
    }];
  }

  // Fallback: town database if rig not found
  const townBeadsDir = resolveBeadsDir(townRoot);
  return [{ workDir: townRoot, beadsDir: townBeadsDir, source: "town" }];
}

// ============================================================================
// Data Fetching
// ============================================================================

/**
 * Fetches beads from a single database.
 * Returns partial results: beads may be empty on failure, with error set.
 */
export async function fetchBeadsFromDatabase(
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

  // Pass sort field to bd if specified and valid
  if (options.sort && (VALID_SORT_FIELDS as readonly string[]).includes(options.sort)) {
    args.push("--sort", options.sort);
  }

  // --reverse for descending order
  if (options.order === "desc") {
    args.push("--reverse");
  }

  // Pass limit to bd CLI. Default to 500 when not specified.
  // Callers that need unlimited results should pass limit: 0 explicitly.
  const bdLimit = options.limit ?? 500;
  args.push("--limit", String(bdLimit));

  const result = await execBd<BeadsIssue[]>(args, { cwd: workDir, beadsDir });
  if (!result.success) {
    const errorCode = result.error?.code ?? "BD_EXEC_FAILED";
    const errorMsg = result.error?.message ?? "bd command failed";
    logInfo("fetchBeadsFromDatabase failed", { source, errorCode, errorMsg });
    return { beads: [], error: { code: errorCode, message: errorMsg } };
  }

  if (!result.data) {
    return { beads: [] };
  }

  let beads = excludeWisps(result.data).map((issue) => transformBead(issue, source));

  if (needsClientSideFilter && statusesToInclude) {
    beads = beads.filter((b) =>
      statusesToInclude.includes(b.status.toLowerCase() as BeadStatus)
    );
  }

  return { beads };
}

/**
 * Fetches beads from a single database with verbose output (includes dependencies).
 * Returns raw issues with dependency data for graph building.
 */
export async function fetchGraphBeadsFromDatabase(
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

  // Graph queries need all beads for correct edge computation
  args.push("--limit", "0");

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

  let issues = excludeWisps(result.data);

  if (statusesToInclude !== null && statusesToInclude.length > 1) {
    issues = issues.filter((issue) =>
      statusesToInclude.includes(issue.status.toLowerCase() as BeadStatus)
    );
  }

  return { issues };
}

// ============================================================================
// Bead Sources
// ============================================================================

/**
 * Lists all available bead sources (projects/rigs with beads databases).
 */
export async function listBeadSources(): Promise<
  BeadsServiceResult<{ sources: BeadSource[]; mode: string }>
> {
  try {
    const beadsDirs = await listAllBeadsDirs();
    const sources: BeadSource[] = beadsDirs.map((dirInfo) => ({
      name: dirInfo.rig ?? "project",
      path: dirInfo.workDir,
      hasBeads: true,
    }));

    return { success: true, data: { sources, mode: "swarm" } };
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
