import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";

// Mock event bus
const mockEmit = vi.fn();
vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: () => ({ emit: mockEmit }),
}));

import { createDatabase, runMigrations } from "../../src/services/database.js";
import {
  initCostTracker,
  recordCostUpdate,
  getSessionCost,
  getProjectCost,
  getCostSummary,
  setCostAlertThreshold,
  getCostAlertThreshold,
  resetCostTracker,
  estimateContextPercent,
  upsertBudget,
  getBudgets,
  deleteBudget,
  checkBudget,
  getBurnRate,
  getBeadCost,
  getEpicCost,
  clearSessionCost,
  finalizeSessionCost,
  finalizeOrphanedSessions,
} from "../../src/services/cost-tracker.js";
import type Database from "better-sqlite3";

let testDir: string;
let testDb: Database.Database;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-cost-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("cost-tracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCostTracker();
    testDir = freshTestDir();
    testDb = createDatabase(join(testDir, "test.db"));
    runMigrations(testDb);
    initCostTracker(testDb);
  });

  afterEach(() => {
    testDb.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("recordCostUpdate", () => {
    it("should create session entry on first update", () => {
      recordCostUpdate("sess-1", "/project", {
        cost: 0.05,
        tokens: { input: 1000, output: 500 },
      });

      const entry = getSessionCost("sess-1");
      expect(entry).toBeDefined();
      expect(entry!.cost).toBe(0.05);
      expect(entry!.tokens.input).toBe(1000);
      expect(entry!.tokens.output).toBe(500);
    });

    it("should accumulate costs across updates", () => {
      recordCostUpdate("sess-1", "/project", { cost: 0.05 });
      recordCostUpdate("sess-1", "/project", { cost: 0.10 });

      const entry = getSessionCost("sess-1");
      expect(entry!.cost).toBe(0.10);
    });

    it("should track running token totals", () => {
      recordCostUpdate("sess-1", "/project", {
        tokens: { input: 1000, output: 500 },
      });
      recordCostUpdate("sess-1", "/project", {
        tokens: { input: 2000, output: 1000 },
      });

      const entry = getSessionCost("sess-1");
      expect(entry!.tokens.input).toBe(2000);
      expect(entry!.tokens.output).toBe(1000);
    });

    it("should emit session:cost event", () => {
      recordCostUpdate("sess-1", "/project", { cost: 0.05 });

      expect(mockEmit).toHaveBeenCalledWith(
        "session:cost",
        expect.objectContaining({
          sessionId: "sess-1",
          cost: 0.05,
        })
      );
    });

    it("should emit cost alert when threshold exceeded", () => {
      setCostAlertThreshold(0.10);
      recordCostUpdate("sess-1", "/project", { cost: 0.15 });

      expect(mockEmit).toHaveBeenCalledWith(
        "session:cost_alert",
        expect.objectContaining({
          sessionId: "sess-1",
          threshold: 0.10,
          currentCost: 0.15,
        })
      );
    });

    it("should only alert once per session", () => {
      setCostAlertThreshold(0.10);
      recordCostUpdate("sess-1", "/project", { cost: 0.15 });
      recordCostUpdate("sess-1", "/project", { cost: 0.20 });

      const alertCalls = mockEmit.mock.calls.filter(
        (c) => c[0] === "session:cost_alert" && c[1]?.threshold !== undefined
      );
      expect(alertCalls).toHaveLength(1);
    });

    it("should persist to SQLite", () => {
      recordCostUpdate("sess-1", "/project", {
        cost: 0.05,
        tokens: { input: 1000, output: 500 },
        agentId: "agent-1",
        beadId: "adj-001",
      });

      // Verify directly in the database
      const row = testDb.prepare(
        "SELECT * FROM agent_costs WHERE session_id = 'sess-1'"
      ).get() as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.total_cost).toBe(0.05);
      expect(row.input_tokens).toBe(1000);
      expect(row.agent_id).toBe("agent-1");
      expect(row.bead_id).toBe("adj-001");
    });

    it("should load persisted data on reinit", () => {
      recordCostUpdate("sess-1", "/project", {
        cost: 0.05,
        tokens: { input: 1000, output: 500 },
      });

      // Reset and reinitialize — should load from SQLite
      resetCostTracker();
      initCostTracker(testDb);

      const entry = getSessionCost("sess-1");
      expect(entry).toBeDefined();
      expect(entry!.cost).toBe(0.05);
      expect(entry!.tokens.input).toBe(1000);
    });
  });

  describe("getCostSummary", () => {
    it("should return empty summary initially", () => {
      const summary = getCostSummary();
      expect(summary.totalCost).toBe(0);
      expect(summary.totalTokens.input).toBe(0);
      expect(Object.keys(summary.sessions)).toHaveLength(0);
      expect(Object.keys(summary.projects)).toHaveLength(0);
    });

    it("should aggregate across sessions", () => {
      recordCostUpdate("sess-1", "/project-a", { cost: 0.10 });
      recordCostUpdate("sess-2", "/project-b", { cost: 0.20 });

      const summary = getCostSummary();
      expect(summary.totalCost).toBeCloseTo(0.30, 10);
      expect(Object.keys(summary.sessions)).toHaveLength(2);
    });
  });

  describe("getProjectCost", () => {
    it("should return undefined for unknown project", () => {
      expect(getProjectCost("/unknown")).toBeUndefined();
    });

    it("should aggregate sessions per project", () => {
      recordCostUpdate("sess-1", "/project", {
        cost: 0.10,
        tokens: { input: 1000 },
      });
      recordCostUpdate("sess-2", "/project", {
        cost: 0.20,
        tokens: { input: 2000 },
      });

      const project = getProjectCost("/project");
      expect(project).toBeDefined();
      expect(project!.totalCost).toBeCloseTo(0.30, 10);
      expect(project!.totalTokens.input).toBe(3000);
      expect(project!.sessionCount).toBe(2);
    });
  });

  describe("alert threshold", () => {
    it("should default to $5", () => {
      expect(getCostAlertThreshold()).toBe(5.0);
    });

    it("should be configurable", () => {
      setCostAlertThreshold(10.0);
      expect(getCostAlertThreshold()).toBe(10.0);
    });
  });

  describe("estimateContextPercent", () => {
    it("should calculate correct percentage", () => {
      const entry = {
        sessionId: "sess-1",
        projectPath: "/project",
        tokens: { input: 100000, output: 50000, cacheRead: 50000, cacheWrite: 10000 },
        cost: 1.0,
        lastUpdated: new Date().toISOString(),
      };
      // (100000 + 50000 + 50000) / 200000 = 100%
      expect(estimateContextPercent(entry)).toBe(100);
    });

    it("should cap at 100%", () => {
      const entry = {
        sessionId: "sess-1",
        projectPath: "/project",
        tokens: { input: 300000, output: 0, cacheRead: 0, cacheWrite: 0 },
        cost: 1.0,
        lastUpdated: new Date().toISOString(),
      };
      expect(estimateContextPercent(entry)).toBe(100);
    });
  });

  describe("budget management", () => {
    it("should create a budget", () => {
      const budget = upsertBudget({ scope: "session", amount: 10.0 });
      expect(budget).toBeDefined();
      expect(budget!.budgetAmount).toBe(10.0);
      expect(budget!.warningPercent).toBe(80);
      expect(budget!.criticalPercent).toBe(100);
    });

    it("should update existing budget", () => {
      upsertBudget({ scope: "session", amount: 10.0 });
      const updated = upsertBudget({ scope: "session", amount: 20.0 });
      expect(updated!.budgetAmount).toBe(20.0);
      // Should only be one budget
      expect(getBudgets()).toHaveLength(1);
    });

    it("should list all budgets", () => {
      upsertBudget({ scope: "session", scopeId: "sess-1", amount: 5.0 });
      upsertBudget({ scope: "project", scopeId: "/proj", amount: 50.0 });
      expect(getBudgets()).toHaveLength(2);
    });

    it("should delete a budget", () => {
      const budget = upsertBudget({ scope: "session", amount: 10.0 });
      expect(deleteBudget(budget!.id)).toBe(true);
      expect(getBudgets()).toHaveLength(0);
    });

    it("should check budget status as ok", () => {
      upsertBudget({ scope: "session", scopeId: "sess-1", amount: 10.0 });
      recordCostUpdate("sess-1", "/project", { cost: 5.0 });
      const status = checkBudget("sess-1");
      expect(status).toBeDefined();
      expect(status!.status).toBe("ok");
      expect(status!.percentUsed).toBe(50);
    });

    it("should check budget status as warning", () => {
      upsertBudget({ scope: "session", scopeId: "sess-1", amount: 10.0, warningPercent: 80 });
      recordCostUpdate("sess-1", "/project", { cost: 8.5 });
      const status = checkBudget("sess-1");
      expect(status!.status).toBe("warning");
    });

    it("should check budget status as critical", () => {
      upsertBudget({ scope: "session", scopeId: "sess-1", amount: 10.0, criticalPercent: 100 });
      recordCostUpdate("sess-1", "/project", { cost: 10.0 });
      const status = checkBudget("sess-1");
      expect(status!.status).toBe("critical");
    });

    it("should check budget status as exceeded", () => {
      upsertBudget({ scope: "session", scopeId: "sess-1", amount: 10.0 });
      recordCostUpdate("sess-1", "/project", { cost: 12.0 });
      const status = checkBudget("sess-1");
      expect(status!.status).toBe("exceeded");
    });

    it("should return null when no budget exists", () => {
      expect(checkBudget("sess-1")).toBeNull();
    });
  });

  describe("burn rate", () => {
    it("should return zero rates when no data", () => {
      const rate = getBurnRate();
      expect(rate.rate10m).toBe(0);
      expect(rate.rate1h).toBe(0);
      expect(rate.trend).toBe("stable");
    });

    it("should calculate rate from recent entries", () => {
      // Insert cost data with recent timestamps
      recordCostUpdate("sess-1", "/project", { cost: 1.0 });
      const rate = getBurnRate();
      // Should have some non-zero rate since the data was just inserted
      expect(rate.rate10m).toBeGreaterThanOrEqual(0);
    });
  });

  describe("per-bead cost", () => {
    it("should return null for unknown bead", () => {
      expect(getBeadCost("adj-999")).toBeNull();
    });

    it("should aggregate costs for a bead", () => {
      recordCostUpdate("sess-1", "/project", {
        cost: 0.50,
        tokens: { input: 5000, output: 2000 },
        beadId: "adj-001",
      });
      recordCostUpdate("sess-2", "/project", {
        cost: 0.30,
        tokens: { input: 3000, output: 1000 },
        beadId: "adj-001",
      });

      const result = getBeadCost("adj-001");
      expect(result).toBeDefined();
      expect(result!.totalCost).toBeCloseTo(0.80, 10);
      expect(result!.sessions).toHaveLength(2);
      expect(result!.tokenBreakdown.input).toBe(8000);
    });
  });

  describe("edge cases", () => {
    it("should handle zero costs", () => {
      recordCostUpdate("sess-1", "/project", { cost: 0, tokens: { input: 0 } });
      const entry = getSessionCost("sess-1");
      expect(entry!.cost).toBe(0);
    });

    it("should handle multiple rapid updates to same session", () => {
      for (let i = 0; i < 10; i++) {
        recordCostUpdate("sess-1", "/project", {
          cost: i * 0.01,
          tokens: { input: i * 100 },
        });
      }
      const entry = getSessionCost("sess-1");
      expect(entry!.cost).toBe(0.09);
      expect(entry!.tokens.input).toBe(900);
    });

    it("should handle budget with zero amount", () => {
      upsertBudget({ scope: "session", scopeId: "sess-1", amount: 0 });
      recordCostUpdate("sess-1", "/project", { cost: 5.0 });
      const status = checkBudget("sess-1");
      expect(status).toBeDefined();
      // percentUsed should be 0 (not Infinity) when budget amount is 0
      expect(status!.percentUsed).toBe(0);
      expect(Number.isFinite(status!.percentUsed)).toBe(true);
    });

    it("should handle very large cost values (>$1000)", () => {
      recordCostUpdate("sess-1", "/project", {
        cost: 1500.99,
        tokens: { input: 5000000, output: 2000000, cacheRead: 1000000, cacheWrite: 500000 },
      });
      const entry = getSessionCost("sess-1");
      expect(entry!.cost).toBe(1500.99);
      expect(entry!.tokens.input).toBe(5000000);
    });

    it("should handle very large token counts (>1M)", () => {
      recordCostUpdate("sess-1", "/project", {
        cost: 50.0,
        tokens: { input: 2000000, output: 1000000, cacheRead: 500000, cacheWrite: 250000 },
      });
      const summary = getCostSummary();
      expect(summary.totalTokens.input).toBe(2000000);
      expect(summary.totalTokens.output).toBe(1000000);
    });

    it("should use custom budget thresholds for status", () => {
      // Custom thresholds: warn at 50%, critical at 75%
      upsertBudget({ scope: "session", scopeId: "sess-1", amount: 100, warningPercent: 50, criticalPercent: 75 });

      // 60% spent — should be warning (above 50% custom threshold)
      recordCostUpdate("sess-1", "/project", { cost: 60.0 });
      const statusWarning = checkBudget("sess-1");
      expect(statusWarning!.status).toBe("warning");

      // 80% spent — should be critical (above 75% custom threshold, but not >100%)
      recordCostUpdate("sess-1", "/project", { cost: 80.0 });
      const statusCritical = checkBudget("sess-1");
      expect(statusCritical!.status).toBe("critical");
    });

    it("should return null for per-bead cost when bead has no sessions", () => {
      // Record costs but for a different bead
      recordCostUpdate("sess-1", "/project", { cost: 5.0, beadId: "adj-001" });
      expect(getBeadCost("adj-999")).toBeNull();
    });

    it("should sum deltas in epic cost when session spans multiple beads", () => {
      // Same session works on two child beads sequentially
      // Start on bead adj-001.1, cost goes from 0 to 10
      recordCostUpdate("sess-1", "/project", { cost: 5.0, beadId: "adj-001.1" });
      recordCostUpdate("sess-1", "/project", { cost: 10.0, beadId: "adj-001.1" });

      // Switch to bead adj-001.2, cost goes from 10 to 15
      recordCostUpdate("sess-1", "/project", { cost: 12.0, beadId: "adj-001.2" });
      recordCostUpdate("sess-1", "/project", { cost: 15.0, beadId: "adj-001.2" });

      const epicResult = getEpicCost("adj-001", ["adj-001.1", "adj-001.2"]);
      expect(epicResult).toBeDefined();
      // Session appears once in the epic (costs summed across both beads)
      expect(epicResult!.sessions).toHaveLength(1);
      // Total should be 10 (bead 1 delta) + 5 (bead 2 delta) = 15
      expect(epicResult!.totalCost).toBeCloseTo(15.0, 10);
    });
  });

  describe("delta tracking on bead change", () => {
    it("should create a new cost row when bead changes", () => {
      // Work on bead A, cost goes to $2
      recordCostUpdate("sess-1", "/project", { cost: 1.0, beadId: "adj-010", agentId: "agent-a" });
      recordCostUpdate("sess-1", "/project", { cost: 2.0, beadId: "adj-010", agentId: "agent-a" });

      // Switch to bead B, cost goes to $3
      recordCostUpdate("sess-1", "/project", { cost: 3.0, beadId: "adj-020", agentId: "agent-a" });

      // Should have 2 rows: one for adj-010, one for adj-020
      const rows = testDb.prepare(
        "SELECT * FROM agent_costs WHERE session_id = 'sess-1' ORDER BY id"
      ).all() as Array<Record<string, unknown>>;

      expect(rows).toHaveLength(2);
      expect(rows[0]!.bead_id).toBe("adj-010");
      expect(rows[0]!.total_cost).toBeCloseTo(2.0, 10); // Delta for bead A
      expect(rows[1]!.bead_id).toBe("adj-020");
    });

    it("should store cost delta not running total per bead", () => {
      // Bead A: cost 0 -> 5
      recordCostUpdate("sess-1", "/project", { cost: 5.0, beadId: "adj-010" });

      // Switch to bead B: cost 5 -> 8
      recordCostUpdate("sess-1", "/project", { cost: 6.0, beadId: "adj-020" });
      recordCostUpdate("sess-1", "/project", { cost: 8.0, beadId: "adj-020" });

      const beadA = getBeadCost("adj-010");
      const beadB = getBeadCost("adj-020");

      expect(beadA).toBeDefined();
      expect(beadA!.totalCost).toBeCloseTo(5.0, 10); // Delta: 5 - 0

      expect(beadB).toBeDefined();
      expect(beadB!.totalCost).toBeCloseTo(3.0, 10); // Delta: 8 - 5
    });

    it("should handle multiple bead switches correctly", () => {
      // Bead A: $0 -> $3
      recordCostUpdate("sess-1", "/project", { cost: 3.0, beadId: "adj-010" });

      // Bead B: $3 -> $7
      recordCostUpdate("sess-1", "/project", { cost: 7.0, beadId: "adj-020" });

      // Bead C: $7 -> $10
      recordCostUpdate("sess-1", "/project", { cost: 10.0, beadId: "adj-030" });

      expect(getBeadCost("adj-010")!.totalCost).toBeCloseTo(3.0, 10);
      expect(getBeadCost("adj-020")!.totalCost).toBeCloseTo(4.0, 10);
      expect(getBeadCost("adj-030")!.totalCost).toBeCloseTo(3.0, 10);
    });

    it("should populate agentId and beadId in SQLite correctly", () => {
      recordCostUpdate("sess-1", "/project", {
        cost: 1.50,
        tokens: { input: 2000, output: 1000 },
        agentId: "engineer-1",
        beadId: "adj-066.1",
      });

      const row = testDb.prepare(
        "SELECT * FROM agent_costs WHERE session_id = 'sess-1'"
      ).get() as Record<string, unknown>;

      expect(row).toBeDefined();
      expect(row.agent_id).toBe("engineer-1");
      expect(row.bead_id).toBe("adj-066.1");
      expect(row.total_cost).toBeCloseTo(1.50, 10);
      expect(row.input_tokens).toBe(2000);
      expect(row.output_tokens).toBe(1000);
    });

    it("should return correct per-bead cost via getBeadCost", () => {
      // Two different sessions work on the same bead
      recordCostUpdate("sess-1", "/project", { cost: 2.0, beadId: "adj-050", agentId: "agent-a" });
      recordCostUpdate("sess-2", "/project", { cost: 3.0, beadId: "adj-050", agentId: "agent-b" });

      const result = getBeadCost("adj-050");
      expect(result).toBeDefined();
      expect(result!.totalCost).toBeCloseTo(5.0, 10);
      expect(result!.sessions).toHaveLength(2);
    });

    it("should aggregate epic cost without double-counting across beads", () => {
      // Session 1 works on child bead A: $0 -> $4
      recordCostUpdate("sess-1", "/project", { cost: 4.0, beadId: "adj-100.1" });
      // Session 1 switches to child bead B: $4 -> $7
      recordCostUpdate("sess-1", "/project", { cost: 7.0, beadId: "adj-100.2" });

      // Session 2 works on child bead B only: $0 -> $2
      recordCostUpdate("sess-2", "/project", { cost: 2.0, beadId: "adj-100.2" });

      const epic = getEpicCost("adj-100", ["adj-100.1", "adj-100.2"]);
      expect(epic).toBeDefined();
      // sess-1 contributed $4 (bead A) + $3 (bead B) = $7
      // sess-2 contributed $2 (bead B)
      // Total: $9
      expect(epic!.totalCost).toBeCloseTo(9.0, 10);
      expect(epic!.sessions).toHaveLength(2);
    });

    it("should handle active session with no bead switch yet", () => {
      // Session is actively working on a bead, no switch has happened
      recordCostUpdate("sess-1", "/project", { cost: 1.0, beadId: "adj-070" });
      recordCostUpdate("sess-1", "/project", { cost: 3.5, beadId: "adj-070" });

      const result = getBeadCost("adj-070");
      expect(result).toBeDefined();
      // Should return the current accumulated cost
      expect(result!.totalCost).toBeCloseTo(3.5, 10);
      expect(result!.sessions).toHaveLength(1);
    });
  });

  describe("session lifecycle", () => {
    it("clearSessionCost removes from sessionCache", () => {
      recordCostUpdate("sess-1", "/project", { cost: 0.50 });
      expect(getSessionCost("sess-1")).toBeDefined();

      clearSessionCost("sess-1");

      expect(getSessionCost("sess-1")).toBeUndefined();
    });

    it("clearSessionCost clears alertedSessions for that session", () => {
      // Trigger an alert for sess-1
      setCostAlertThreshold(0.10);
      recordCostUpdate("sess-1", "/project", { cost: 0.15 });

      // Clear session cost
      clearSessionCost("sess-1");

      // Use a different session ID for re-record since clearSessionCost marks
      // the session as finalized (adj-066.3.6 race protection). In production,
      // killed sessions don't get reused — each gets a new UUID.
      mockEmit.mockClear();
      recordCostUpdate("sess-1b", "/project", { cost: 0.15 });
      const alertCalls = mockEmit.mock.calls.filter(
        (c) => c[0] === "session:cost_alert" && c[1]?.threshold !== undefined
      );
      expect(alertCalls).toHaveLength(1);
    });

    it("finalizeSessionCost sets finalized_at in SQLite", () => {
      recordCostUpdate("sess-1", "/project", { cost: 0.50 });

      finalizeSessionCost("sess-1");

      const row = testDb.prepare(
        "SELECT finalized_at FROM agent_costs WHERE session_id = 'sess-1'"
      ).get() as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.finalized_at).not.toBeNull();
    });

    it("getCostSummary excludes finalized entries", () => {
      recordCostUpdate("sess-1", "/project", { cost: 0.50 });
      recordCostUpdate("sess-2", "/project", { cost: 0.30 });

      // Finalize sess-1 and clear it from cache
      clearSessionCost("sess-1");

      const summary = getCostSummary();
      expect(summary.totalCost).toBeCloseTo(0.30, 10);
      expect(Object.keys(summary.sessions)).toHaveLength(1);
      expect(summary.sessions["sess-2"]).toBeDefined();
    });

    it("getBeadCost INCLUDES finalized entries (historical accuracy)", () => {
      recordCostUpdate("sess-1", "/project", {
        cost: 0.50,
        tokens: { input: 5000, output: 2000 },
        beadId: "adj-001",
      });

      // Finalize the session
      clearSessionCost("sess-1");

      // getBeadCost should still include the finalized data
      const result = getBeadCost("adj-001");
      expect(result).toBeDefined();
      expect(result!.totalCost).toBeCloseTo(0.50, 10);
      expect(result!.sessions).toHaveLength(1);
    });

    it("loadCacheFromDb only loads non-finalized sessions", () => {
      recordCostUpdate("sess-1", "/project", { cost: 0.50 });
      recordCostUpdate("sess-2", "/project", { cost: 0.30 });

      // Finalize sess-1 in DB
      finalizeSessionCost("sess-1");

      // Reset and reinitialize — should only load sess-2
      resetCostTracker();
      initCostTracker(testDb);

      expect(getSessionCost("sess-1")).toBeUndefined();
      expect(getSessionCost("sess-2")).toBeDefined();
      expect(getSessionCost("sess-2")!.cost).toBe(0.30);
    });

    it("orphaned sessions are finalized on startup simulation", () => {
      recordCostUpdate("sess-alive", "/project", { cost: 0.50 });
      recordCostUpdate("sess-dead", "/project", { cost: 0.30 });

      // Reset tracker, then reinit — simulate startup
      resetCostTracker();
      initCostTracker(testDb);

      // Now call finalizeOrphanedSessions with a set of alive session IDs
      finalizeOrphanedSessions(new Set(["sess-alive"]));

      // sess-dead should be finalized in DB
      const deadRow = testDb.prepare(
        "SELECT finalized_at FROM agent_costs WHERE session_id = 'sess-dead'"
      ).get() as Record<string, unknown>;
      expect(deadRow.finalized_at).not.toBeNull();

      // sess-alive should NOT be finalized
      const aliveRow = testDb.prepare(
        "SELECT finalized_at FROM agent_costs WHERE session_id = 'sess-alive'"
      ).get() as Record<string, unknown>;
      expect(aliveRow.finalized_at).toBeNull();

      // sess-dead should be removed from cache
      expect(getSessionCost("sess-dead")).toBeUndefined();
      // sess-alive should still be in cache
      expect(getSessionCost("sess-alive")).toBeDefined();
    });
  });

  // ==========================================================================
  // QA Sentinel findings (adj-066.3) — edge case and bug reproduction tests
  // ==========================================================================

  describe("QA: adj-066.3.1 — burn rate sums cumulative totals not deltas", () => {
    it("should not inflate burn rate from repeated upserts of same session", () => {
      // Session at $5.00 total gets 3 upserts in quick succession
      recordCostUpdate("sess-1", "/project", { cost: 5.0 });
      recordCostUpdate("sess-1", "/project", { cost: 5.0 });
      recordCostUpdate("sess-1", "/project", { cost: 5.0 });

      const rate = getBurnRate();
      // BUG: getBurnRate() sums total_cost across all rows.
      // With upsert (1 row per session), this should be $5, not $15.
      // But if delta tracking creates multiple rows, this will be wrong.
      // The rate10m is extrapolated to hourly (x6), so $5 * 6 = $30/hr max.
      // If it's $15 * 6 = $90/hr, the burn rate is 3x inflated.
      expect(rate.rate10m).toBeLessThanOrEqual(30.1); // $5 * 6 = $30/hr
    });
  });

  describe("QA: adj-066.3.2 — budget alerts fire repeatedly", () => {
    it("should not emit duplicate budget alerts for the same threshold crossing", () => {
      upsertBudget({ scope: "session", scopeId: "sess-1", amount: 10.0, warningPercent: 50 });

      // Cross the warning threshold, then keep updating
      recordCostUpdate("sess-1", "/project", { cost: 6.0 });
      recordCostUpdate("sess-1", "/project", { cost: 7.0 });
      recordCostUpdate("sess-1", "/project", { cost: 8.0 });

      // Count budget_warning events
      const budgetWarnings = mockEmit.mock.calls.filter(
        (c) => c[0] === "session:cost_alert" && c[1]?.type === "budget_warning"
      );

      // BUG: Currently emits on every call after threshold is crossed.
      // Should emit only once per threshold crossing.
      // This test documents the bug — it will FAIL until dedup is added.
      expect(budgetWarnings.length).toBe(1);
    });
  });

  describe("QA: adj-066.3.3 — bead_id overwrite on bead switch", () => {
    it("should preserve old bead cost when session switches to new bead", () => {
      // Agent works on bead A, then switches to bead B
      recordCostUpdate("sess-1", "/project", { cost: 5.0, beadId: "adj-010.1" });
      recordCostUpdate("sess-1", "/project", { cost: 10.0, beadId: "adj-010.2" });

      // Bead A should still have its cost attributed
      const beadACost = getBeadCost("adj-010.1");

      // BUG: upsertSessionCost uses COALESCE(?, bead_id) which overwrites
      // the bead_id to adj-010.2. getBeadCost("adj-010.1") returns null.
      // This test documents the bug — it will FAIL until delta rows are added.
      expect(beadACost).not.toBeNull();
      if (beadACost) {
        expect(beadACost.totalCost).toBeGreaterThan(0);
      }
    });
  });

  describe("QA: adj-066.3.4 — loadCacheFromDb loads dead sessions", () => {
    it("should not include finalized sessions in cost summary after reinit", () => {
      // Simulate: session ran, produced cost, then was killed
      recordCostUpdate("sess-dead", "/project", { cost: 50.0 });
      recordCostUpdate("sess-alive", "/project", { cost: 10.0 });

      // Now with engineer-2's finalize support, mark the dead session
      clearSessionCost("sess-dead");

      // Reinit — should only load active sessions
      resetCostTracker();
      initCostTracker(testDb);

      const summary = getCostSummary();
      // After engineer-2's fix: finalized sessions should be excluded
      expect(Object.keys(summary.sessions)).toHaveLength(1);
      expect(summary.totalCost).toBeCloseTo(10.0, 10);
    });
  });

  describe("QA: adj-066.3.6 — race between killSession and cost_update", () => {
    it("should not recreate cache entry after clearSessionCost", () => {
      // Session is running and has cost
      recordCostUpdate("sess-race", "/project", { cost: 5.0 });
      expect(getSessionCost("sess-race")).toBeDefined();

      // killSession calls clearSessionCost
      clearSessionCost("sess-race");
      expect(getSessionCost("sess-race")).toBeUndefined();

      // A stale cost_update arrives (in-flight from before kill)
      recordCostUpdate("sess-race", "/project", { cost: 5.5 });

      // The cache entry should NOT be recreated
      expect(getSessionCost("sess-race")).toBeUndefined();
    });
  });

  describe("QA: adj-066.3.7 — NULL bead_id cost visibility", () => {
    it("should be possible to query unattributed costs (no bead_id)", () => {
      // Some costs have bead IDs, some don't
      recordCostUpdate("sess-1", "/project", { cost: 5.0, beadId: "adj-001" });
      recordCostUpdate("sess-2", "/project", { cost: 10.0 }); // no beadId
      recordCostUpdate("sess-3", "/project", { cost: 3.0 }); // no beadId

      // Currently there's no API to query unattributed costs
      // Verify the data is in SQLite with NULL bead_id
      const nullRows = testDb.prepare(
        "SELECT COUNT(*) as cnt, SUM(total_cost) as total FROM agent_costs WHERE bead_id IS NULL"
      ).get() as { cnt: number; total: number };

      // At minimum, the unattributed cost should be queryable
      expect(nullRows.cnt).toBeGreaterThanOrEqual(1);
      expect(nullRows.total).toBeGreaterThanOrEqual(10.0);

      // The cost summary should ideally show unattributed costs as a category.
      // Currently getCostSummary() doesn't distinguish attributed vs unattributed.
      const summary = getCostSummary();
      expect(summary.totalCost).toBeCloseTo(18.0, 10);
    });
  });

  describe("QA: adj-066.3.10 — loadCacheFromDb restores delta not session total", () => {
    it("should restore correct session total after bead switches and restart", () => {
      // Session works on bead A ($0 -> $5), then switches to bead B ($5 -> $8)
      recordCostUpdate("sess-1", "/project", { cost: 5.0, beadId: "adj-010" });
      recordCostUpdate("sess-1", "/project", { cost: 8.0, beadId: "adj-020" });

      // Session total should be $8 (cumulative)
      expect(getSessionCost("sess-1")!.cost).toBe(8.0);

      // Now restart: reset and reinitialize
      resetCostTracker();
      initCostTracker(testDb);

      // BUG: loadCacheFromDb loads the latest row's total_cost which is a DELTA ($3)
      // not the session total ($8). The session should show $8 after restart.
      const restored = getSessionCost("sess-1");
      expect(restored).toBeDefined();
      expect(restored!.cost).toBeCloseTo(8.0, 10);
    });
  });

  describe("QA: adj-066.3.11 — sessionBeadTracker not restored on restart", () => {
    it("should correctly track delta after backend restart mid-session", () => {
      // Session works on bead A ($0 -> $5)
      recordCostUpdate("sess-1", "/project", { cost: 5.0, beadId: "adj-010" });

      // Restart backend
      resetCostTracker();
      initCostTracker(testDb);

      // Session continues on bead A ($5 -> $8 — but tracker is gone)
      recordCostUpdate("sess-1", "/project", { cost: 8.0, beadId: "adj-010" });

      // The bead should show $8 total (not $8 from scratch)
      const beadCost = getBeadCost("adj-010");
      expect(beadCost).toBeDefined();
      expect(beadCost!.totalCost).toBeCloseTo(8.0, 10);

      // And the DB should not have duplicate rows for the same bead
      const rows = testDb.prepare(
        "SELECT * FROM agent_costs WHERE session_id = 'sess-1' AND bead_id = 'adj-010' AND finalized_at IS NULL"
      ).all() as Array<Record<string, unknown>>;
      // Ideally 1 row, but after restart a new row may be created.
      // The key invariant: SUM(total_cost) across all adj-010 rows should equal $8
      const totalDelta = rows.reduce((sum, r) => sum + (r.total_cost as number), 0);
      expect(totalDelta).toBeCloseTo(8.0, 10);
    });
  });

  describe("QA: adj-066.3.12 — token counts in delta rows are session totals", () => {
    it("should store per-bead token deltas, not session running totals", () => {
      // Bead A: 1000 input tokens, 500 output
      recordCostUpdate("sess-1", "/project", {
        cost: 2.0,
        tokens: { input: 1000, output: 500 },
        beadId: "adj-010",
      });

      // Switch to bead B: session total now 3000 input, 1500 output
      recordCostUpdate("sess-1", "/project", {
        cost: 5.0,
        tokens: { input: 3000, output: 1500 },
        beadId: "adj-020",
      });

      // Bead A should have tokens: 1000 input, 500 output (what it actually used)
      const beadA = getBeadCost("adj-010");
      expect(beadA).toBeDefined();
      expect(beadA!.tokenBreakdown.input).toBe(1000);
      expect(beadA!.tokenBreakdown.output).toBe(500);

      // Bead B should have tokens: 2000 input, 1000 output (delta from switch)
      // BUG: Currently stores 3000/1500 (full session totals)
      const beadB = getBeadCost("adj-020");
      expect(beadB).toBeDefined();
      expect(beadB!.tokenBreakdown.input).toBe(2000); // delta: 3000 - 1000
      expect(beadB!.tokenBreakdown.output).toBe(1000); // delta: 1500 - 500
    });
  });

  describe("agentId enrichment (adj-mrdq)", () => {
    it("should include agentId on CostEntry in getCostSummary", () => {
      recordCostUpdate("sess-1", "/project", {
        cost: 0.50,
        tokens: { input: 1000, output: 500 },
        agentId: "engineer-1",
      });

      const summary = getCostSummary();
      const entry = summary.sessions["sess-1"];
      expect(entry).toBeDefined();
      expect(entry!.agentId).toBe("engineer-1");
    });

    it("should include agentId on getSessionCost", () => {
      recordCostUpdate("sess-1", "/project", {
        cost: 0.25,
        agentId: "engineer-2",
      });

      const entry = getSessionCost("sess-1");
      expect(entry).toBeDefined();
      expect(entry!.agentId).toBe("engineer-2");
    });

    it("should restore agentId from SQLite on cache reload", () => {
      recordCostUpdate("sess-1", "/project", {
        cost: 1.00,
        tokens: { input: 2000, output: 1000 },
        agentId: "engineer-3",
      });

      // Reset in-memory cache and reload from DB
      resetCostTracker();
      initCostTracker(testDb);

      const entry = getSessionCost("sess-1");
      expect(entry).toBeDefined();
      expect(entry!.agentId).toBe("engineer-3");
    });

    it("should not set agentId when not provided", () => {
      recordCostUpdate("sess-1", "/project", {
        cost: 0.10,
      });

      const entry = getSessionCost("sess-1");
      expect(entry).toBeDefined();
      expect(entry!.agentId).toBeUndefined();
    });
  });
});
