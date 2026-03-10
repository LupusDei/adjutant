/**
 * CostTracker — parses, stores, and streams cost/token data from Claude Code sessions.
 *
 * Integrates with OutputParser cost_update events. Persists to SQLite
 * (agent_costs table) with an in-memory cache for fast reads.
 * Emits cost events via EventBus for WebSocket streaming to iOS.
 */

import type Database from "better-sqlite3";
import { logInfo, logWarn } from "../utils/index.js";
import { getEventBus } from "./event-bus.js";

// ============================================================================
// Types
// ============================================================================

export interface CostEntry {
  sessionId: string;
  projectPath: string;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  cost: number;
  lastUpdated: string;
  /** Direct context window usage % from Claude Code status bar (0-100) */
  contextPercent?: number;
  /** Agent name associated with this session (enriched from session registry) */
  agentId?: string;
  /** Reconciliation status: estimated (default), verified (JSONL matches), discrepancy */
  reconciliationStatus?: "estimated" | "verified" | "discrepancy";
  /** JSONL-computed cost for comparison with statusline cost */
  jsonlCost?: number;
}

export interface CostSummary {
  totalCost: number;
  totalTokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  sessions: Record<string, CostEntry>;
  projects: Record<string, ProjectCostSummary>;
}

export interface ProjectCostSummary {
  projectPath: string;
  totalCost: number;
  totalTokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  sessionCount: number;
}

export interface CostAlert {
  sessionId: string;
  threshold: number;
  currentCost: number;
}

export interface BudgetStatus {
  budget: number;
  spent: number;
  percentUsed: number;
  status: "ok" | "warning" | "critical" | "exceeded";
}

export interface BudgetRecord {
  id: number;
  scope: "session" | "project";
  scopeId: string | null;
  budgetAmount: number;
  warningPercent: number;
  criticalPercent: number;
  createdAt: string;
  updatedAt: string;
}

export interface BurnRate {
  rate10m: number;
  rate1h: number;
  trend: "increasing" | "stable" | "decreasing";
}

export interface BeadCostResult {
  beadId: string;
  totalCost: number;
  sessions: Array<{
    sessionId: string;
    cost: number;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  }>;
  tokenBreakdown: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

// ============================================================================
// SQLite row types
// ============================================================================

interface AgentCostRow {
  id: number;
  session_id: string;
  agent_id: string | null;
  bead_id: string | null;
  project_path: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_cost: number;
  recorded_at: string;
}

interface BudgetRow {
  id: number;
  scope: string;
  scope_id: string | null;
  budget_amount: number;
  warning_percent: number;
  critical_percent: number;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// State
// ============================================================================

let db: Database.Database | null = null;

/** In-memory cache keyed by sessionId for fast lookups */
const sessionCache = new Map<string, CostEntry>();

/**
 * Tracks the last known bead and cost snapshot per session.
 * When the beadId changes, we snapshot the cost at the switch point
 * so we can compute deltas for per-bead cost attribution.
 */
interface BeadSnapshot {
  beadId: string;
  /** Session total cost at the time this bead was assigned */
  costAtStart: number;
  /** Token counts at the time this bead was assigned (for per-bead token deltas) */
  tokensAtStart: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** SQLite row ID for the current bead's cost entry */
  rowId?: number;
}
const sessionBeadTracker = new Map<string, BeadSnapshot>();

let alertThreshold = 5.0; // $5 default
const alertedSessions = new Set<string>();

/**
 * Tracks which budget alert levels have already fired per session.
 * Prevents duplicate budget alerts from firing on every cost_update poll.
 * Key: sessionId, Value: set of alert levels already emitted ("warning" | "critical" | "exceeded")
 */
const budgetAlertedSessions = new Map<string, Set<string>>();

/**
 * Tracks sessions that have been finalized (killed).
 * Prevents race condition where a cost_update in flight recreates the cache entry
 * after killSession() has already cleared it.
 */
const finalizedSessions = new Set<string>();

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize cost tracker with a SQLite database instance.
 * Loads existing session data into the in-memory cache.
 */
export function initCostTracker(database?: Database.Database): void {
  if (database) {
    db = database;
  }
  // Load existing data into cache
  loadCacheFromDb();
  const summary = getCostSummary();
  logInfo("Cost tracker initialized", { totalCost: summary.totalCost });
}

/**
 * Record a cost update from the output parser.
 * Persists to SQLite and updates the in-memory cache.
 */
export function recordCostUpdate(
  sessionId: string,
  projectPath: string,
  update: {
    tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
    cost?: number;
    contextPercent?: number;
    agentId?: string;
    beadId?: string;
  }
): void {
  // Skip finalized sessions to prevent race with killSession (adj-066.3.6).
  // After clearSessionCost() marks a session as finalized, any in-flight cost_update
  // that arrives should not recreate the cache entry.
  if (finalizedSessions.has(sessionId)) return;

  // Get or create cache entry
  let entry = sessionCache.get(sessionId);
  if (!entry) {
    entry = {
      sessionId,
      projectPath,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      cost: 0,
      lastUpdated: new Date().toISOString(),
    };
    sessionCache.set(sessionId, entry);
  }

  // Capture snapshots before update (needed for bead-switch delta calculation)
  const previousCost = entry.cost;
  const previousTokens = {
    input: entry.tokens.input,
    output: entry.tokens.output,
    cacheRead: entry.tokens.cacheRead,
    cacheWrite: entry.tokens.cacheWrite,
  };

  // Update tokens (these are running totals from Claude Code, so take the max)
  if (update.tokens) {
    if (update.tokens.input !== undefined) {
      entry.tokens.input = Math.max(entry.tokens.input, update.tokens.input);
    }
    if (update.tokens.output !== undefined) {
      entry.tokens.output = Math.max(entry.tokens.output, update.tokens.output);
    }
    if (update.tokens.cacheRead !== undefined) {
      entry.tokens.cacheRead = Math.max(entry.tokens.cacheRead, update.tokens.cacheRead);
    }
    if (update.tokens.cacheWrite !== undefined) {
      entry.tokens.cacheWrite = Math.max(entry.tokens.cacheWrite, update.tokens.cacheWrite);
    }
  }

  // Update cost
  if (update.cost !== undefined) {
    entry.cost = Math.max(entry.cost, update.cost);
  }

  // Update context percent (direct from Claude Code status bar)
  if (update.contextPercent !== undefined) {
    entry.contextPercent = update.contextPercent;
  }

  // Store agent name for display in cost summaries (adj-mrdq)
  if (update.agentId) {
    entry.agentId = update.agentId;
  }

  entry.lastUpdated = new Date().toISOString();

  // Persist to SQLite
  upsertSessionCost(sessionId, entry, update.agentId, update.beadId, previousCost, previousTokens);

  // Emit via EventBus
  getEventBus().emit("session:cost", {
    sessionId,
    cost: entry.cost,
    tokens: entry.tokens,
  });

  // Check alert threshold
  if (entry.cost >= alertThreshold && !alertedSessions.has(sessionId)) {
    alertedSessions.add(sessionId);
    const alert: CostAlert = {
      sessionId,
      threshold: alertThreshold,
      currentCost: entry.cost,
    };
    getEventBus().emit("session:cost_alert", alert as unknown as Record<string, unknown>);
    logInfo("Cost alert triggered", { sessionId, cost: entry.cost, threshold: alertThreshold });
  }

  // Check budgets
  checkAndEmitBudgetAlerts(sessionId, entry);
}

/**
 * Get cost data for a specific session.
 */
export function getSessionCost(sessionId: string): CostEntry | undefined {
  return sessionCache.get(sessionId);
}

/**
 * Get cost data for a specific project (aggregated across sessions).
 */
export function getProjectCost(projectPath: string): ProjectCostSummary | undefined {
  // Aggregate from cache
  const sessions = Array.from(sessionCache.values()).filter(
    (s) => s.projectPath === projectPath
  );
  if (sessions.length === 0) return undefined;

  return {
    projectPath,
    totalCost: sessions.reduce((sum, s) => sum + s.cost, 0),
    totalTokens: {
      input: sessions.reduce((sum, s) => sum + s.tokens.input, 0),
      output: sessions.reduce((sum, s) => sum + s.tokens.output, 0),
      cacheRead: sessions.reduce((sum, s) => sum + s.tokens.cacheRead, 0),
      cacheWrite: sessions.reduce((sum, s) => sum + s.tokens.cacheWrite, 0),
    },
    sessionCount: sessions.length,
  };
}

/**
 * Get full cost summary.
 */
export function getCostSummary(): CostSummary {
  const sessions: Record<string, CostEntry> = {};
  const projects: Record<string, ProjectCostSummary> = {};
  let totalCost = 0;
  const totalTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  for (const [sid, entry] of sessionCache) {
    sessions[sid] = entry;
    totalCost += entry.cost;
    totalTokens.input += entry.tokens.input;
    totalTokens.output += entry.tokens.output;
    totalTokens.cacheRead += entry.tokens.cacheRead;
    totalTokens.cacheWrite += entry.tokens.cacheWrite;

    // Build project aggregation
    if (!projects[entry.projectPath]) {
      projects[entry.projectPath] = {
        projectPath: entry.projectPath,
        totalCost: 0,
        totalTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        sessionCount: 0,
      };
    }
    // Safe to assert: we just created the entry above if it didn't exist
    const proj = projects[entry.projectPath]!;
    proj.totalCost += entry.cost;
    proj.totalTokens.input += entry.tokens.input;
    proj.totalTokens.output += entry.tokens.output;
    proj.totalTokens.cacheRead += entry.tokens.cacheRead;
    proj.totalTokens.cacheWrite += entry.tokens.cacheWrite;
    proj.sessionCount += 1;
  }

  return { totalCost, totalTokens, sessions, projects };
}

/**
 * Set the cost alert threshold.
 */
export function setCostAlertThreshold(threshold: number): void {
  alertThreshold = threshold;
  alertedSessions.clear();
}

/**
 * Get the current alert threshold.
 */
export function getCostAlertThreshold(): number {
  return alertThreshold;
}

/**
 * Clear cost data for a specific session.
 * Removes from in-memory cache, clears alert tracking, and finalizes in SQLite.
 * Called when a session is killed so agent cards show fresh data after restart.
 */
export function clearSessionCost(sessionId: string): void {
  sessionCache.delete(sessionId);
  alertedSessions.delete(sessionId);
  budgetAlertedSessions.delete(sessionId);
  sessionBeadTracker.delete(sessionId);
  finalizedSessions.add(sessionId);
  finalizeSessionCost(sessionId);
}

/**
 * Mark a session's cost entries as finalized in SQLite.
 * Sets finalized_at timestamp so they're excluded from active cost summaries
 * but preserved for historical per-bead/epic cost queries.
 */
export function finalizeSessionCost(sessionId: string): void {
  if (!db) return;
  try {
    db.prepare(
      "UPDATE agent_costs SET finalized_at = datetime('now') WHERE session_id = ? AND finalized_at IS NULL"
    ).run(sessionId);
  } catch (err) {
    logWarn("Failed to finalize session cost", { sessionId, error: String(err) });
  }
}

/**
 * Finalize orphaned sessions on startup.
 * Cross-references cached session IDs with a set of known-alive session IDs.
 * Any session in the cache that is NOT alive gets finalized and removed.
 */
export function finalizeOrphanedSessions(aliveSessionIds: Set<string>): void {
  const cachedIds = Array.from(sessionCache.keys());
  for (const sessionId of cachedIds) {
    if (!aliveSessionIds.has(sessionId)) {
      clearSessionCost(sessionId);
      logInfo("Finalized orphaned session cost", { sessionId });
    }
  }
}

/**
 * Reset cost data (for testing).
 */
export function resetCostTracker(): void {
  sessionCache.clear();
  sessionBeadTracker.clear();
  db = null;
  alertThreshold = 5.0;
  alertedSessions.clear();
  budgetAlertedSessions.clear();
  finalizedSessions.clear();
}

/**
 * Estimate context window usage percentage from a CostEntry's token counts.
 * Uses input + output + cacheRead tokens (excludes cacheWrite which doesn't
 * consume context window space).
 */
const DEFAULT_CONTEXT_LIMIT = 200_000; // Claude Opus/Sonnet context window

export function estimateContextPercent(entry: CostEntry, contextLimit = DEFAULT_CONTEXT_LIMIT): number {
  const totalUsed = entry.tokens.input + entry.tokens.output + entry.tokens.cacheRead;
  return Math.min(100, Math.round((totalUsed / contextLimit) * 100));
}

// ============================================================================
// Budget Management
// ============================================================================

/**
 * Create or update a budget.
 */
export function upsertBudget(opts: {
  scope: "session" | "project";
  scopeId?: string;
  amount: number;
  warningPercent?: number;
  criticalPercent?: number;
}): BudgetRecord | null {
  if (!db) return null;
  const now = new Date().toISOString();

  // Check if a budget already exists for this scope/scopeId
  const existing = db.prepare(
    "SELECT id FROM cost_budgets WHERE scope = ? AND (scope_id = ? OR (scope_id IS NULL AND ? IS NULL))"
  ).get(opts.scope, opts.scopeId ?? null, opts.scopeId ?? null) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE cost_budgets SET budget_amount = ?, warning_percent = ?, critical_percent = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      opts.amount,
      opts.warningPercent ?? 80,
      opts.criticalPercent ?? 100,
      now,
      existing.id
    );
    return getBudgetById(existing.id);
  }

  const result = db.prepare(
    `INSERT INTO cost_budgets (scope, scope_id, budget_amount, warning_percent, critical_percent, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    opts.scope,
    opts.scopeId ?? null,
    opts.amount,
    opts.warningPercent ?? 80,
    opts.criticalPercent ?? 100,
    now,
    now
  );

  return getBudgetById(Number(result.lastInsertRowid));
}

/**
 * Get a budget by ID.
 */
export function getBudgetById(id: number): BudgetRecord | null {
  if (!db) return null;
  const row = db.prepare("SELECT * FROM cost_budgets WHERE id = ?").get(id) as BudgetRow | undefined;
  if (!row) return null;
  return mapBudgetRow(row);
}

/**
 * Get all budgets.
 */
export function getBudgets(): BudgetRecord[] {
  if (!db) return [];
  const rows = db.prepare("SELECT * FROM cost_budgets ORDER BY created_at DESC").all() as BudgetRow[];
  return rows.map(mapBudgetRow);
}

/**
 * Delete a budget by ID.
 */
export function deleteBudget(id: number): boolean {
  if (!db) return false;
  const result = db.prepare("DELETE FROM cost_budgets WHERE id = ?").run(id);
  return result.changes > 0;
}

/**
 * Check budget status for a session.
 */
export function checkBudget(sessionId: string): BudgetStatus | null {
  if (!db) return null;

  // Look for a session-scoped budget first, then a global session budget
  const budget = db.prepare(
    "SELECT * FROM cost_budgets WHERE scope = 'session' AND (scope_id = ? OR scope_id IS NULL) ORDER BY scope_id DESC LIMIT 1"
  ).get(sessionId) as BudgetRow | undefined;

  if (!budget) return null;

  const entry = sessionCache.get(sessionId);
  const spent = entry?.cost ?? 0;
  const percentUsed = budget.budget_amount > 0 ? (spent / budget.budget_amount) * 100 : 0;

  let status: BudgetStatus["status"] = "ok";
  if (percentUsed >= budget.critical_percent) {
    status = percentUsed > 100 ? "exceeded" : "critical";
  } else if (percentUsed >= budget.warning_percent) {
    status = "warning";
  }

  return {
    budget: budget.budget_amount,
    spent,
    percentUsed,
    status,
  };
}

// ============================================================================
// Burn Rate
// ============================================================================

/**
 * Calculate burn rate from recent cost entries.
 * Uses last 10 minutes and last 1 hour windows.
 */
export function getBurnRate(): BurnRate {
  if (!db) return { rate10m: 0, rate1h: 0, trend: "stable" };

  const now = new Date();
  const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString();

  // Sum costs in each window
  const cost10m = (db.prepare(
    "SELECT COALESCE(SUM(total_cost), 0) as total FROM agent_costs WHERE recorded_at >= ?"
  ).get(tenMinAgo) as { total: number }).total;

  const cost1h = (db.prepare(
    "SELECT COALESCE(SUM(total_cost), 0) as total FROM agent_costs WHERE recorded_at >= ?"
  ).get(oneHourAgo) as { total: number }).total;

  // For trend: compare first half vs second half of the hour
  const costFirstHalf = (db.prepare(
    "SELECT COALESCE(SUM(total_cost), 0) as total FROM agent_costs WHERE recorded_at >= ? AND recorded_at < ?"
  ).get(oneHourAgo, thirtyMinAgo) as { total: number }).total;

  const costSecondHalf = (db.prepare(
    "SELECT COALESCE(SUM(total_cost), 0) as total FROM agent_costs WHERE recorded_at >= ?"
  ).get(thirtyMinAgo) as { total: number }).total;

  // Calculate hourly rates
  const rate10m = cost10m * 6; // Extrapolate 10min to hourly rate
  const rate1h = cost1h;

  // Determine trend
  let trend: BurnRate["trend"] = "stable";
  if (costFirstHalf > 0 || costSecondHalf > 0) {
    const ratio = costSecondHalf / (costFirstHalf || 0.001);
    if (ratio > 1.25) trend = "increasing";
    else if (ratio < 0.75) trend = "decreasing";
  }

  return { rate10m, rate1h, trend };
}

// ============================================================================
// Per-Bead Cost Aggregation
// ============================================================================

/**
 * Get aggregated cost for a specific bead ID.
 *
 * With delta-based tracking, each row's total_cost represents the cost
 * accumulated while working on that specific bead. We SUM the deltas
 * across all rows for the bead, plus handle active sessions (where the
 * delta is still accumulating).
 */
export function getBeadCost(beadId: string): BeadCostResult | null {
  if (!db) return null;

  const rows = db.prepare(
    `SELECT session_id, total_cost, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
     FROM agent_costs WHERE bead_id = ?`
  ).all(beadId) as AgentCostRow[];

  if (rows.length === 0) return null;

  // Sum deltas per session (a session may have multiple rows for the same bead
  // if it was reassigned back to it, though this is rare)
  const sessionMap = new Map<string, {
    sessionId: string;
    cost: number;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  }>();

  for (const row of rows) {
    const existing = sessionMap.get(row.session_id);
    if (existing) {
      // Sum deltas for same session+bead
      existing.cost += row.total_cost;
    } else {
      sessionMap.set(row.session_id, {
        sessionId: row.session_id,
        cost: row.total_cost,
        tokens: {
          input: row.input_tokens,
          output: row.output_tokens,
          cacheRead: row.cache_read_tokens,
          cacheWrite: row.cache_write_tokens,
        },
      });
    }
  }

  // Check for active sessions still working on this bead
  // (the delta in the DB may be stale; use in-memory cache for live cost)
  for (const [sessionId, tracker] of sessionBeadTracker) {
    if (tracker.beadId === beadId) {
      const cached = sessionCache.get(sessionId);
      if (cached) {
        const liveDelta = cached.cost - tracker.costAtStart;
        const existing = sessionMap.get(sessionId);
        if (existing) {
          // Replace with live delta (more accurate than DB value)
          existing.cost = liveDelta;
        }
      }
    }
  }

  const sessions = Array.from(sessionMap.values());
  const totalCost = sessions.reduce((sum, s) => sum + s.cost, 0);
  const tokenBreakdown = {
    input: sessions.reduce((sum, s) => sum + s.tokens.input, 0),
    output: sessions.reduce((sum, s) => sum + s.tokens.output, 0),
    cacheRead: sessions.reduce((sum, s) => sum + s.tokens.cacheRead, 0),
    cacheWrite: sessions.reduce((sum, s) => sum + s.tokens.cacheWrite, 0),
  };

  return { beadId, totalCost, sessions, tokenBreakdown };
}

/**
 * Get aggregated cost for an epic (recursively sums child bead costs).
 * Accepts a list of child bead IDs (caller resolves hierarchy).
 *
 * With delta-based tracking, each bead's cost is independent (stored as
 * a delta, not a running total). So we SUM all per-bead costs across
 * the epic without risk of double-counting — even when a single session
 * spans multiple beads under the same epic.
 */
export function getEpicCost(epicBeadId: string, childBeadIds: string[]): BeadCostResult | null {
  const allIds = [epicBeadId, ...childBeadIds];
  const allSessions: BeadCostResult["sessions"] = [];

  for (const beadId of allIds) {
    const result = getBeadCost(beadId);
    if (result) {
      allSessions.push(...result.sessions);
    }
  }

  if (allSessions.length === 0) return null;

  // Accumulate costs per session across all beads (SUM, not MAX).
  // With delta tracking, each bead's cost is already the delta for that segment,
  // so summing gives the total cost the session spent across the epic.
  const sessionMap = new Map<string, BeadCostResult["sessions"][0]>();
  for (const s of allSessions) {
    const existing = sessionMap.get(s.sessionId);
    if (existing) {
      existing.cost += s.cost;
      existing.tokens.input += s.tokens.input;
      existing.tokens.output += s.tokens.output;
      existing.tokens.cacheRead += s.tokens.cacheRead;
      existing.tokens.cacheWrite += s.tokens.cacheWrite;
    } else {
      sessionMap.set(s.sessionId, { ...s, tokens: { ...s.tokens } });
    }
  }

  const sessions = Array.from(sessionMap.values());
  const totalCost = sessions.reduce((sum, s) => sum + s.cost, 0);
  const tokenBreakdown = {
    input: sessions.reduce((sum, s) => sum + s.tokens.input, 0),
    output: sessions.reduce((sum, s) => sum + s.tokens.output, 0),
    cacheRead: sessions.reduce((sum, s) => sum + s.tokens.cacheRead, 0),
    cacheWrite: sessions.reduce((sum, s) => sum + s.tokens.cacheWrite, 0),
  };

  return { beadId: epicBeadId, totalCost, sessions, tokenBreakdown };
}

// ============================================================================
// Private — SQLite persistence
// ============================================================================

/**
 * Upsert a session's cost entry into the agent_costs table.
 *
 * Delta tracking: When the beadId changes for a session, we INSERT a new row
 * with the cost delta (cost accumulated while working on the previous bead)
 * and start a new row for the new bead. This enables accurate per-bead cost
 * attribution even when a single session works on multiple beads sequentially.
 *
 * The `total_cost` column stores the DELTA (cost for this bead segment only),
 * not the running session total.
 */
function upsertSessionCost(
  sessionId: string,
  entry: CostEntry,
  agentId?: string,
  beadId?: string,
  previousCost?: number,
  previousTokens?: { input: number; output: number; cacheRead: number; cacheWrite: number }
): void {
  if (!db) return;
  try {
    const tracker = sessionBeadTracker.get(sessionId);
    const effectiveBeadId = beadId ?? null;
    const trackerBeadId = tracker?.beadId ?? null;

    // Detect bead change: if we have a tracker and the bead is changing
    const beadChanged = tracker && effectiveBeadId !== null && trackerBeadId !== effectiveBeadId;

    if (beadChanged) {
      // Finalize the previous bead's row with the delta cost and token deltas.
      // Use previousCost (cost before this update) to calculate what the old bead earned,
      // since entry.cost already includes the new update's cost.
      const previousDelta = (previousCost ?? entry.cost) - tracker.costAtStart;
      // Token deltas for the previous bead (adj-066.3.12).
      // Use previousTokens (tokens before this update) since the current update's
      // tokens may already include work for the new bead.
      const prevTokensAtStart = tracker.tokensAtStart;
      const tokensBeforeUpdate = previousTokens ?? entry.tokens;
      const prevTokenDeltas = {
        input: tokensBeforeUpdate.input - prevTokensAtStart.input,
        output: tokensBeforeUpdate.output - prevTokensAtStart.output,
        cacheRead: tokensBeforeUpdate.cacheRead - prevTokensAtStart.cacheRead,
        cacheWrite: tokensBeforeUpdate.cacheWrite - prevTokensAtStart.cacheWrite,
      };
      if (tracker.rowId) {
        db.prepare(
          `UPDATE agent_costs SET total_cost = ?,
             input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_write_tokens = ?,
             recorded_at = datetime('now') WHERE id = ?`
        ).run(previousDelta, prevTokenDeltas.input, prevTokenDeltas.output,
              prevTokenDeltas.cacheRead, prevTokenDeltas.cacheWrite, tracker.rowId);
      }

      // The switch boundary is previousCost — cost before this update.
      // Any cost in this update (entry.cost - previousCost) belongs to the new bead.
      const switchPoint = previousCost ?? entry.cost;
      const newBeadInitialDelta = entry.cost - switchPoint;

      // Token snapshot at switch point = tokens before this update (the new bead starts here)
      const tokenSnapshot = previousTokens ?? {
        input: entry.tokens.input,
        output: entry.tokens.output,
        cacheRead: entry.tokens.cacheRead,
        cacheWrite: entry.tokens.cacheWrite,
      };

      // New bead token deltas = tokens gained in this update (entry.tokens - previousTokens)
      const newBeadTokenDeltas = {
        input: entry.tokens.input - tokenSnapshot.input,
        output: entry.tokens.output - tokenSnapshot.output,
        cacheRead: entry.tokens.cacheRead - tokenSnapshot.cacheRead,
        cacheWrite: entry.tokens.cacheWrite - tokenSnapshot.cacheWrite,
      };

      // Start a new row for the new bead
      const result = db.prepare(
        `INSERT INTO agent_costs (session_id, agent_id, bead_id, project_path,
           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
           total_cost, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).run(
        sessionId,
        agentId ?? null,
        effectiveBeadId,
        entry.projectPath,
        newBeadTokenDeltas.input,
        newBeadTokenDeltas.output,
        newBeadTokenDeltas.cacheRead,
        newBeadTokenDeltas.cacheWrite,
        newBeadInitialDelta
      );

      // Update tracker for the new bead (costAtStart = switch boundary)
      sessionBeadTracker.set(sessionId, {
        beadId: effectiveBeadId,
        costAtStart: switchPoint,
        tokensAtStart: tokenSnapshot,
        rowId: Number(result.lastInsertRowid),
      });
    } else {
      // Same bead (or no bead) — upsert the existing row
      const existing = tracker?.rowId
        ? (db.prepare("SELECT id FROM agent_costs WHERE id = ?").get(tracker.rowId) as { id: number } | undefined)
        : (db.prepare("SELECT id FROM agent_costs WHERE session_id = ? ORDER BY id DESC LIMIT 1").get(sessionId) as { id: number } | undefined);

      if (existing) {
        // Calculate delta cost for the current bead segment
        const costAtStart = tracker?.costAtStart ?? 0;
        const deltaCost = entry.cost - costAtStart;

        // Calculate token deltas for the current bead (adj-066.3.12)
        const tokensAtStart = tracker?.tokensAtStart ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        const tokenDeltas = {
          input: entry.tokens.input - tokensAtStart.input,
          output: entry.tokens.output - tokensAtStart.output,
          cacheRead: entry.tokens.cacheRead - tokensAtStart.cacheRead,
          cacheWrite: entry.tokens.cacheWrite - tokensAtStart.cacheWrite,
        };

        db.prepare(
          `UPDATE agent_costs SET
             input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_write_tokens = ?,
             total_cost = ?, project_path = ?, agent_id = COALESCE(?, agent_id),
             bead_id = COALESCE(?, bead_id), recorded_at = datetime('now')
           WHERE id = ?`
        ).run(
          tokenDeltas.input,
          tokenDeltas.output,
          tokenDeltas.cacheRead,
          tokenDeltas.cacheWrite,
          deltaCost,
          entry.projectPath,
          agentId ?? null,
          effectiveBeadId,
          existing.id
        );

        // Initialize tracker if not yet set
        if (!tracker) {
          sessionBeadTracker.set(sessionId, {
            beadId: effectiveBeadId ?? "",
            costAtStart: 0,
            tokensAtStart: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            rowId: existing.id,
          });
        } else if (!tracker.rowId) {
          tracker.rowId = existing.id;
        }
      } else {
        // First row for this session
        const result = db.prepare(
          `INSERT INTO agent_costs (session_id, agent_id, bead_id, project_path,
             input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
             total_cost, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        ).run(
          sessionId,
          agentId ?? null,
          effectiveBeadId,
          entry.projectPath,
          entry.tokens.input,
          entry.tokens.output,
          entry.tokens.cacheRead,
          entry.tokens.cacheWrite,
          entry.cost // First row: delta = total cost so far
        );

        sessionBeadTracker.set(sessionId, {
          beadId: effectiveBeadId ?? "",
          costAtStart: 0,
          tokensAtStart: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          rowId: Number(result.lastInsertRowid),
        });
      }
    }
  } catch (err) {
    logWarn("Failed to persist cost data to SQLite", { error: String(err) });
  }
}

/**
 * Load session data from SQLite into the in-memory cache on startup.
 *
 * Since total_cost in each row is a DELTA (per-bead cost segment), we must
 * SUM all deltas per session to reconstruct the true session total (adj-066.3.10).
 *
 * Also reconstructs sessionBeadTracker from the latest row per session so that
 * bead-switch delta tracking works correctly after restart (adj-066.3.11).
 */
function loadCacheFromDb(): void {
  if (!db) return;
  try {
    // Sum all non-finalized deltas per session to get the true session total (adj-066.3.10)
    // Token columns are also deltas (adj-066.3.12), so SUM them too.
    const summaryRows = db.prepare(
      `SELECT session_id,
              SUM(total_cost) as total_cost,
              SUM(input_tokens) as input_tokens,
              SUM(output_tokens) as output_tokens,
              SUM(cache_read_tokens) as cache_read_tokens,
              SUM(cache_write_tokens) as cache_write_tokens,
              MAX(recorded_at) as recorded_at,
              MAX(project_path) as project_path
       FROM agent_costs
       WHERE finalized_at IS NULL
       GROUP BY session_id`
    ).all() as AgentCostRow[];

    for (const row of summaryRows) {
      sessionCache.set(row.session_id, {
        sessionId: row.session_id,
        projectPath: row.project_path ?? "",
        tokens: {
          input: row.input_tokens,
          output: row.output_tokens,
          cacheRead: row.cache_read_tokens,
          cacheWrite: row.cache_write_tokens,
        },
        cost: row.total_cost,
        lastUpdated: row.recorded_at,
      });
    }

    // Restore sessionBeadTracker from the latest row per session (adj-066.3.11).
    // costAtStart = session total - latest row's delta, so future deltas are correct.
    const latestRows = db.prepare(
      `SELECT ac.* FROM agent_costs ac
       INNER JOIN (SELECT session_id, MAX(id) as max_id FROM agent_costs WHERE finalized_at IS NULL GROUP BY session_id) latest
       ON ac.id = latest.max_id`
    ).all() as AgentCostRow[];

    for (const row of latestRows) {
      const sessionTotal = sessionCache.get(row.session_id)?.cost ?? 0;
      // costAtStart = session total minus the current bead's delta
      const costAtStart = sessionTotal - row.total_cost;

      // Restore agentId from the latest row (adj-mrdq)
      const cachedEntry = sessionCache.get(row.session_id);
      if (cachedEntry && row.agent_id) {
        cachedEntry.agentId = row.agent_id;
      }

      // For token snapshots on restore, we compute from the sum of all OTHER
      // bead rows' tokens vs the session total tokens. Since we track tokens
      // as running totals (MAX), the token snapshot at bead start is approximately
      // the session's current tokens minus what the current bead used.
      // After restart, token deltas for the current bead will be approximate.
      sessionBeadTracker.set(row.session_id, {
        beadId: row.bead_id ?? "",
        costAtStart,
        tokensAtStart: {
          input: (cachedEntry?.tokens.input ?? 0) - row.input_tokens,
          output: (cachedEntry?.tokens.output ?? 0) - row.output_tokens,
          cacheRead: (cachedEntry?.tokens.cacheRead ?? 0) - row.cache_read_tokens,
          cacheWrite: (cachedEntry?.tokens.cacheWrite ?? 0) - row.cache_write_tokens,
        },
        rowId: row.id,
      });
    }
  } catch (err) {
    logWarn("Failed to load cost data from SQLite", { error: String(err) });
  }
}

function mapBudgetRow(row: BudgetRow): BudgetRecord {
  return {
    id: row.id,
    scope: row.scope as "session" | "project",
    scopeId: row.scope_id,
    budgetAmount: row.budget_amount,
    warningPercent: row.warning_percent,
    criticalPercent: row.critical_percent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Check budget and emit alerts if thresholds are crossed.
 * Deduplicates alerts per session per level (warning/critical/exceeded)
 * so each level fires at most once per session (adj-066.3.2).
 */
function checkAndEmitBudgetAlerts(sessionId: string, _entry: CostEntry): void {
  const budgetStatus = checkBudget(sessionId);
  if (!budgetStatus) return;
  if (budgetStatus.status === "ok") return;

  // Get or create the set of already-alerted levels for this session
  let alerted = budgetAlertedSessions.get(sessionId);
  if (!alerted) {
    alerted = new Set<string>();
    budgetAlertedSessions.set(sessionId, alerted);
  }

  const alertLevel = budgetStatus.status; // "warning" | "critical" | "exceeded"
  if (alerted.has(alertLevel)) return; // Already fired this level

  alerted.add(alertLevel);

  const alertType = alertLevel === "warning" ? "budget_warning" : "budget_exceeded";
  getEventBus().emit("session:cost_alert", {
    sessionId,
    type: alertType,
    budget: budgetStatus.budget,
    spent: budgetStatus.spent,
    percentUsed: budgetStatus.percentUsed,
  } as unknown as Record<string, unknown>);
}
