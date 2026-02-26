/**
 * Prefix map management for beads.
 *
 * Maps bead ID prefixes (e.g., "hq", "adj", "gb") to their source
 * rig names. Used by other beads modules to route CLI commands to
 * the correct database and to label beads in the UI.
 */

import { readFileSync } from "fs";
import { join } from "path";

import { listAllBeadsDirs } from "../workspace/index.js";
import { logInfo } from "../../utils/index.js";

// ============================================================================
// Module State
// ============================================================================

let prefixToSourceMap: Map<string, string> | null = null;

const DEFAULT_PREFIX_MAP_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

let prefixMapRefreshIntervalId: ReturnType<typeof setInterval> | null = null;

// ============================================================================
// Private Helpers
// ============================================================================

function readPrefixFromConfig(beadsDir: string): string | null {
  try {
    const configPath = join(beadsDir, "config.yaml");
    const content = readFileSync(configPath, "utf8");
    const prefixMatch = content.match(/^(?:prefix|issue-prefix):\s*["']?([a-zA-Z0-9_-]+)["']?\s*$/m);
    return prefixMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

async function buildPrefixMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  map.set("hq", "town");

  try {
    const beadsDirs = await listAllBeadsDirs();
    for (const dirInfo of beadsDirs) {
      if (!dirInfo.rig) continue;
      const prefix = readPrefixFromConfig(dirInfo.path);
      if (prefix && !map.has(prefix)) {
        map.set(prefix, dirInfo.rig);
      }
    }
  } catch {
    // If discovery fails, map will just have the "hq" -> "town" default
  }

  return map;
}

// ============================================================================
// Internal Exports (used by sibling modules)
// ============================================================================

/**
 * Loads prefix-to-source mapping, building it synchronously if not cached.
 * @internal Used by beads-database and beads-epics modules.
 */
export function loadPrefixMap(): Map<string, string> {
  if (prefixToSourceMap) return prefixToSourceMap;
  prefixToSourceMap = new Map();
  prefixToSourceMap.set("hq", "town");
  return prefixToSourceMap;
}

/**
 * Ensures prefix map is fully built (async). Call before using prefixToSource.
 * @internal Used by beads-database, beads-epics, beads-queries modules.
 */
export async function ensurePrefixMap(): Promise<void> {
  if (!prefixToSourceMap || prefixToSourceMap.size <= 1) {
    prefixToSourceMap = await buildPrefixMap();
  }
}

/**
 * Maps bead prefix to rig name for UI grouping.
 */
export function prefixToSource(beadId: string): string {
  const prefix = beadId.split("-")[0];
  if (!prefix) return "unknown";
  const map = loadPrefixMap();
  return map.get(prefix) ?? "unknown";
}

// ============================================================================
// Public API
// ============================================================================

export async function refreshPrefixMap(): Promise<void> {
  prefixToSourceMap = await buildPrefixMap();
  logInfo("prefix map refreshed", { prefixCount: prefixToSourceMap.size });
}

export function startPrefixMapRefreshScheduler(
  intervalMs: number = DEFAULT_PREFIX_MAP_REFRESH_INTERVAL_MS
): void {
  if (prefixMapRefreshIntervalId !== null) return;

  buildPrefixMap()
    .then((map) => {
      prefixToSourceMap = map;
      logInfo("prefix map initialized", { prefixCount: map.size });
    })
    .catch((err) => {
      console.error("[BeadsPrefixMap] Initial prefix map build failed:", err);
    });

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
        console.error("[BeadsPrefixMap] Prefix map refresh failed:", err);
      });
  }, intervalMs);

  logInfo("prefix map refresh scheduler started", {
    intervalMin: Math.round(intervalMs / 60000),
  });
}

export function stopPrefixMapRefreshScheduler(): void {
  if (prefixMapRefreshIntervalId !== null) {
    clearInterval(prefixMapRefreshIntervalId);
    prefixMapRefreshIntervalId = null;
    logInfo("prefix map refresh scheduler stopped");
  }
}

// ============================================================================
// Test-only exports
// ============================================================================

/** @internal Exported for testing */
export const _prefixToSource = prefixToSource;

/** @internal Reset prefix map cache — for testing only */
export function _resetPrefixMap(): void {
  prefixToSourceMap = null;
}
