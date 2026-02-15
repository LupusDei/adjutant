/**
 * CostTracker — parses, stores, and streams cost/token data from Claude Code sessions.
 *
 * Integrates with OutputParser cost_update events. Stores running totals
 * per-session and per-project in ~/.adjutant/costs.json. Emits cost events
 * via EventBus for WebSocket streaming to iOS.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
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

// ============================================================================
// State
// ============================================================================

let costData: CostSummary = createEmptySummary();
let costFilePath: string | null = null;
let alertThreshold = 5.0; // $5 default
const alertedSessions = new Set<string>();

function createEmptySummary(): CostSummary {
  return {
    totalCost: 0,
    totalTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    sessions: {},
    projects: {},
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize cost tracker and load persisted data.
 */
export function initCostTracker(customPath?: string): void {
  const dir = customPath ?? join(homedir(), ".adjutant");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  costFilePath = join(dir, "costs.json");

  if (existsSync(costFilePath)) {
    try {
      const raw = readFileSync(costFilePath, "utf8");
      costData = JSON.parse(raw) as CostSummary;
    } catch (err) {
      logWarn("Failed to load cost data", { error: String(err) });
      costData = createEmptySummary();
    }
  }

  logInfo("Cost tracker initialized", { totalCost: costData.totalCost });
}

/**
 * Record a cost update from the output parser.
 */
export function recordCostUpdate(
  sessionId: string,
  projectPath: string,
  update: {
    tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
    cost?: number;
  }
): void {
  // Initialize session entry
  if (!costData.sessions[sessionId]) {
    costData.sessions[sessionId] = {
      sessionId,
      projectPath,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      cost: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  const entry = costData.sessions[sessionId];

  // Update tokens (these are running totals from Claude Code, so take the max)
  if (update.tokens) {
    if (update.tokens.input !== undefined) {
      const delta = Math.max(0, update.tokens.input - entry.tokens.input);
      entry.tokens.input = update.tokens.input;
      costData.totalTokens.input += delta;
    }
    if (update.tokens.output !== undefined) {
      const delta = Math.max(0, update.tokens.output - entry.tokens.output);
      entry.tokens.output = update.tokens.output;
      costData.totalTokens.output += delta;
    }
    if (update.tokens.cacheRead !== undefined) {
      const delta = Math.max(0, update.tokens.cacheRead - entry.tokens.cacheRead);
      entry.tokens.cacheRead = update.tokens.cacheRead;
      costData.totalTokens.cacheRead += delta;
    }
    if (update.tokens.cacheWrite !== undefined) {
      const delta = Math.max(0, update.tokens.cacheWrite - entry.tokens.cacheWrite);
      entry.tokens.cacheWrite = update.tokens.cacheWrite;
      costData.totalTokens.cacheWrite += delta;
    }
  }

  // Update cost
  if (update.cost !== undefined) {
    const delta = Math.max(0, update.cost - entry.cost);
    entry.cost = update.cost;
    costData.totalCost += delta;
  }

  entry.lastUpdated = new Date().toISOString();

  // Update project aggregation
  updateProjectSummary(projectPath);

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
    getEventBus().emit("session:cost_alert", alert);
    logInfo("Cost alert triggered", { sessionId, cost: entry.cost, threshold: alertThreshold });
  }

  // Persist (debounced via caller if needed)
  saveCostData();
}

/**
 * Get cost data for a specific session.
 */
export function getSessionCost(sessionId: string): CostEntry | undefined {
  return costData.sessions[sessionId];
}

/**
 * Get cost data for a specific project (aggregated across sessions).
 */
export function getProjectCost(projectPath: string): ProjectCostSummary | undefined {
  return costData.projects[projectPath];
}

/**
 * Get full cost summary.
 */
export function getCostSummary(): CostSummary {
  return { ...costData };
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
  costData = createEmptySummary();
  costFilePath = null;
  alertThreshold = 5.0;
  alertedSessions.clear();
}

// ============================================================================
// Private
// ============================================================================

function updateProjectSummary(projectPath: string): void {
  const sessions = Object.values(costData.sessions).filter(
    (s) => s.projectPath === projectPath
  );

  if (sessions.length === 0) {
    delete costData.projects[projectPath];
    return;
  }

  costData.projects[projectPath] = {
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

function saveCostData(): void {
  if (!costFilePath) return;
  try {
    writeFileSync(costFilePath, JSON.stringify(costData, null, 2), "utf8");
  } catch (err) {
    logWarn("Failed to save cost data", { error: String(err) });
  }
}
