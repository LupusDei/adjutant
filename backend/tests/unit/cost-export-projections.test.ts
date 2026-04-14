/**
 * Tests for cost export (adj-066.4.4) and cost projections (adj-066.4.5).
 * Tests the pure functions getCostExportRows and getCostProjection.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

import {
  initCostTracker,
  resetCostTracker,
  recordCostUpdate,
  getCostExportRows,
  getCostProjection,
} from "../../src/services/cost-tracker.js";

// ============================================================================
// In-memory SQLite setup
// ============================================================================

let db: Database.Database;

function createSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      agent_id TEXT,
      bead_id TEXT,
      project_path TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      total_cost REAL DEFAULT 0,
      context_percent REAL,
      recorded_at TEXT DEFAULT (datetime('now')),
      finalized_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_agent_costs_session ON agent_costs(session_id);
    CREATE INDEX IF NOT EXISTS idx_agent_costs_bead ON agent_costs(bead_id);
    CREATE INDEX IF NOT EXISTS idx_agent_costs_recorded ON agent_costs(recorded_at);

    CREATE TABLE IF NOT EXISTS cost_budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      scope_id TEXT,
      budget_amount REAL NOT NULL,
      warning_percent REAL DEFAULT 80,
      critical_percent REAL DEFAULT 100,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

describe("getCostExportRows", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    initCostTracker(db);
  });

  afterEach(() => {
    resetCostTracker();
    db.close();
  });

  it("should return empty array when no cost data exists", () => {
    const rows = getCostExportRows();
    expect(rows).toEqual([]);
  });

  it("should return cost rows with correct fields", () => {
    recordCostUpdate("session-1", "/project/a", {
      tokens: { input: 1000, output: 500, cacheRead: 100, cacheWrite: 50 },
      cost: 2.50,
      agentId: "nova",
      beadId: "adj-001",
    });

    const rows = getCostExportRows();
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      sessionId: "session-1",
      agentId: "nova",
      beadId: "adj-001",
      projectPath: "/project/a",
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 100,
      cacheWriteTokens: 50,
    });
    expect(rows[0]!.cost).toBeCloseTo(2.50, 2);
  });

  it("should filter by agentId", () => {
    recordCostUpdate("session-1", "/project", {
      cost: 1.0,
      agentId: "nova",
    });
    recordCostUpdate("session-2", "/project", {
      cost: 2.0,
      agentId: "raynor",
    });

    const rows = getCostExportRows({ agentId: "nova" });
    expect(rows.length).toBe(1);
    expect(rows[0]!.agentId).toBe("nova");
  });

  it("should filter by beadId", () => {
    recordCostUpdate("session-1", "/project", {
      cost: 1.0,
      beadId: "adj-001",
    });
    recordCostUpdate("session-2", "/project", {
      cost: 2.0,
      beadId: "adj-002",
    });

    const rows = getCostExportRows({ beadId: "adj-001" });
    expect(rows.length).toBe(1);
    expect(rows[0]!.beadId).toBe("adj-001");
  });
});

describe("getCostProjection", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    initCostTracker(db);
  });

  afterEach(() => {
    resetCostTracker();
    db.close();
  });

  it("should return zero values when no cost data exists", () => {
    const projection = getCostProjection();
    expect(projection.currentCost).toBe(0);
    expect(projection.estimatedCompletionCost).toBeNull();
    expect(projection.estimatedRemainingCost).toBeNull();
    expect(projection.burnRatePerHour).toBe(0);
    expect(projection.costTrend).toEqual([]);
  });

  it("should calculate projections with percent complete", () => {
    recordCostUpdate("session-1", "/project", {
      cost: 10.0,
      tokens: { input: 5000, output: 2500 },
    });

    // At 50% complete, total should be ~$20
    const projection = getCostProjection(50);
    expect(projection.currentCost).toBe(10.0);
    expect(projection.estimatedCompletionCost).toBeCloseTo(20.0, 1);
    expect(projection.estimatedRemainingCost).toBeCloseTo(10.0, 1);
  });

  it("should return null projections without percent complete", () => {
    recordCostUpdate("session-1", "/project", { cost: 10.0 });

    const projection = getCostProjection();
    expect(projection.currentCost).toBe(10.0);
    expect(projection.estimatedCompletionCost).toBeNull();
    expect(projection.estimatedRemainingCost).toBeNull();
  });

  it("should return null projections when percent is 0 or 100", () => {
    recordCostUpdate("session-1", "/project", { cost: 10.0 });

    const proj0 = getCostProjection(0);
    expect(proj0.estimatedCompletionCost).toBeNull();

    const proj100 = getCostProjection(100);
    expect(proj100.estimatedCompletionCost).toBeNull();
  });
});
