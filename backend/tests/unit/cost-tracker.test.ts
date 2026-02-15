import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock event bus
const mockEmit = vi.fn();
vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: () => ({ emit: mockEmit }),
}));

// Mock fs
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    readFileSync: vi.fn(() => "{}"),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
  };
});

import {
  initCostTracker,
  recordCostUpdate,
  getSessionCost,
  getProjectCost,
  getCostSummary,
  setCostAlertThreshold,
  getCostAlertThreshold,
  resetCostTracker,
} from "../../src/services/cost-tracker.js";

describe("cost-tracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCostTracker();
    initCostTracker("/tmp/test-adjutant");
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
        (c) => c[0] === "session:cost_alert"
      );
      expect(alertCalls).toHaveLength(1);
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
});
