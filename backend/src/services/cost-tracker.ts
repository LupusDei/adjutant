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

let alertThreshold = 5.0; // $5 default
const alertedSessions = new Set<string>();

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

  entry.lastUpdated = new Date().toISOString();

  // Persist to SQLite
  upsertSessionCost(sessionId, entry, update.agentId, update.beadId);

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
 * Reset cost data (for testing).
 */
export function resetCostTracker(): void {
  sessionCache.clear();
  db = null;
  alertThreshold = 5.0;
  alertedSessions.clear();
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
 */
export function getBeadCost(beadId: string): BeadCostResult | null {
  if (!db) return null;

  const rows = db.prepare(
    `SELECT session_id, total_cost, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
     FROM agent_costs WHERE bead_id = ?`
  ).all(beadId) as AgentCostRow[];

  if (rows.length === 0) return null;

  // Aggregate by session (take latest/max per session)
  const sessionMap = new Map<string, {
    sessionId: string;
    cost: number;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  }>();

  for (const row of rows) {
    const existing = sessionMap.get(row.session_id);
    if (!existing || row.total_cost > existing.cost) {
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

  // Deduplicate sessions (a session may contribute to multiple beads)
  const sessionMap = new Map<string, BeadCostResult["sessions"][0]>();
  for (const s of allSessions) {
    const existing = sessionMap.get(s.sessionId);
    if (!existing || s.cost > existing.cost) {
      sessionMap.set(s.sessionId, s);
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
 * Uses INSERT OR REPLACE keyed on session_id.
 */
function upsertSessionCost(
  sessionId: string,
  entry: CostEntry,
  agentId?: string,
  beadId?: string
): void {
  if (!db) return;
  try {
    // Check if row exists for this session
    const existing = db.prepare(
      "SELECT id FROM agent_costs WHERE session_id = ? ORDER BY id DESC LIMIT 1"
    ).get(sessionId) as { id: number } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE agent_costs SET
           input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_write_tokens = ?,
           total_cost = ?, project_path = ?, agent_id = COALESCE(?, agent_id),
           bead_id = COALESCE(?, bead_id), recorded_at = datetime('now')
         WHERE id = ?`
      ).run(
        entry.tokens.input,
        entry.tokens.output,
        entry.tokens.cacheRead,
        entry.tokens.cacheWrite,
        entry.cost,
        entry.projectPath,
        agentId ?? null,
        beadId ?? null,
        existing.id
      );
    } else {
      db.prepare(
        `INSERT INTO agent_costs (session_id, agent_id, bead_id, project_path,
           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
           total_cost, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).run(
        sessionId,
        agentId ?? null,
        beadId ?? null,
        entry.projectPath,
        entry.tokens.input,
        entry.tokens.output,
        entry.tokens.cacheRead,
        entry.tokens.cacheWrite,
        entry.cost
      );
    }
  } catch (err) {
    logWarn("Failed to persist cost data to SQLite", { error: String(err) });
  }
}

/**
 * Load session data from SQLite into the in-memory cache on startup.
 */
function loadCacheFromDb(): void {
  if (!db) return;
  try {
    // Get the latest row per session
    const rows = db.prepare(
      `SELECT ac.* FROM agent_costs ac
       INNER JOIN (SELECT session_id, MAX(id) as max_id FROM agent_costs GROUP BY session_id) latest
       ON ac.id = latest.max_id`
    ).all() as AgentCostRow[];

    for (const row of rows) {
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
 */
function checkAndEmitBudgetAlerts(sessionId: string, _entry: CostEntry): void {
  const budgetStatus = checkBudget(sessionId);
  if (!budgetStatus) return;

  if (budgetStatus.status === "warning") {
    getEventBus().emit("session:cost_alert", {
      sessionId,
      type: "budget_warning",
      budget: budgetStatus.budget,
      spent: budgetStatus.spent,
      percentUsed: budgetStatus.percentUsed,
    } as unknown as Record<string, unknown>);
  } else if (budgetStatus.status === "critical" || budgetStatus.status === "exceeded") {
    getEventBus().emit("session:cost_alert", {
      sessionId,
      type: "budget_exceeded",
      budget: budgetStatus.budget,
      spent: budgetStatus.spent,
      percentUsed: budgetStatus.percentUsed,
    } as unknown as Record<string, unknown>);
  }
}
