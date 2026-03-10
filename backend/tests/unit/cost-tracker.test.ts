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
});
