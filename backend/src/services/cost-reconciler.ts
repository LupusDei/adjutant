/**
 * Cost reconciliation service.
 *
 * Compares statusline-reported costs (from cost-tracker) against
 * JSONL-computed costs (from jsonl-cost-reader) and determines
 * reconciliation status.
 *
 * Thresholds:
 * - "verified": |statuslineCost - jsonlCost| < 5% OR < $0.10 (whichever is larger)
 * - "discrepancy": difference exceeds both thresholds
 */

import { logWarn } from "../utils/index.js";
import { getCostSummary, getSessionCost } from "./cost-tracker.js";
import { findSessionLogs, parseJsonlSessionCost } from "./jsonl-cost-reader.js";

// ============================================================================
// Types
// ============================================================================

export interface ReconciliationResult {
  sessionId: string;
  statuslineCost: number;
  jsonlCost: number;
  difference: number;
  percentDiff: number;
  status: "verified" | "discrepancy";
}

// ============================================================================
// Constants
// ============================================================================

/** Absolute cost difference threshold (dollars). */
const ABSOLUTE_THRESHOLD = 0.10;

/** Relative cost difference threshold (percent). */
const RELATIVE_THRESHOLD = 5;

// ============================================================================
// Public API
// ============================================================================

/**
 * Reconcile a single session's statusline cost against JSONL-computed cost.
 *
 * Returns null if:
 * - No statusline cost exists for the session
 * - No JSONL log file can be found/matched for the session
 */
export async function reconcileSession(
  sessionId: string,
  projectPath: string,
): Promise<ReconciliationResult | null> {
  const statuslineEntry = getSessionCost(sessionId);
  if (!statuslineEntry) return null;

  // Find JSONL log files for the project
  const homeDir = process.env["HOME"] ?? "";
  const logFiles = await findSessionLogs(homeDir, projectPath);
  if (logFiles.length === 0) return null;

  // Find the log file matching this session ID
  const matchingFile = logFiles.find((f) => f.includes(sessionId));
  if (!matchingFile) return null;

  let jsonlCost: number;
  try {
    const parsed = await parseJsonlSessionCost(matchingFile);
    jsonlCost = parsed.totalCost;
  } catch (err) {
    logWarn("Failed to parse JSONL for reconciliation", { sessionId, error: String(err) });
    return null;
  }

  return buildResult(sessionId, statuslineEntry.cost, jsonlCost);
}

/**
 * Reconcile all active sessions.
 * Returns results only for sessions where JSONL data is available.
 */
export async function reconcileAllSessions(): Promise<ReconciliationResult[]> {
  const summary = getCostSummary();
  const results: ReconciliationResult[] = [];

  for (const entry of Object.values(summary.sessions)) {
    try {
      const result = await reconcileSession(entry.sessionId, entry.projectPath);
      if (result) {
        results.push(result);
      }
    } catch (err) {
      logWarn("Failed to reconcile session", {
        sessionId: entry.sessionId,
        error: String(err),
      });
    }
  }

  return results;
}

// ============================================================================
// Private
// ============================================================================

/**
 * Build a reconciliation result from two cost values.
 * Uses the "whichever is larger" rule: verified if < 5% OR < $0.10.
 */
function buildResult(
  sessionId: string,
  statuslineCost: number,
  jsonlCost: number,
): ReconciliationResult {
  const difference = Math.abs(statuslineCost - jsonlCost);
  const avgCost = (statuslineCost + jsonlCost) / 2;
  const percentDiff = avgCost > 0 ? (difference / avgCost) * 100 : 0;

  // "verified" if the difference is within EITHER threshold
  const withinAbsolute = difference < ABSOLUTE_THRESHOLD;
  const withinRelative = percentDiff < RELATIVE_THRESHOLD;
  const status: ReconciliationResult["status"] =
    withinAbsolute || withinRelative ? "verified" : "discrepancy";

  return {
    sessionId,
    statuslineCost,
    jsonlCost,
    difference,
    percentDiff,
    status,
  };
}
