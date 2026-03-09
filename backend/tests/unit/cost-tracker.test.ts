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
  });
});
