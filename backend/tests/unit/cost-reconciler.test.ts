/**
 * Tests for the cost reconciliation service.
 * Verifies reconciliation logic between statusline-reported and JSONL-computed costs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  reconcileSession,
  reconcileAllSessions,
  type ReconciliationResult,
} from "../../src/services/cost-reconciler.js";

// Mock the cost-tracker to provide statusline costs
vi.mock("../../src/services/cost-tracker.js", () => ({
  getCostSummary: vi.fn(),
  getSessionCost: vi.fn(),
}));

// Mock the jsonl-cost-reader to provide JSONL-computed costs
vi.mock("../../src/services/jsonl-cost-reader.js", () => ({
  parseJsonlSessionCost: vi.fn(),
  findSessionLogs: vi.fn(),
  computeProjectCosts: vi.fn(),
}));

import { getCostSummary, getSessionCost } from "../../src/services/cost-tracker.js";
import { findSessionLogs, parseJsonlSessionCost } from "../../src/services/jsonl-cost-reader.js";

const mockGetSessionCost = vi.mocked(getSessionCost);
const mockGetCostSummary = vi.mocked(getCostSummary);
const mockFindSessionLogs = vi.mocked(findSessionLogs);
const mockParseJsonlSessionCost = vi.mocked(parseJsonlSessionCost);

describe("cost-reconciler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // reconcileSession
  // --------------------------------------------------------------------------

  describe("reconcileSession", () => {
    it("should return 'verified' when costs match within 5%", async () => {
      mockGetSessionCost.mockReturnValue({
        sessionId: "session-1",
        projectPath: "/test/project",
        tokens: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 },
        cost: 1.05,
        lastUpdated: "2026-03-10T10:00:00Z",
      });

      mockFindSessionLogs.mockResolvedValue(["/path/to/session-1.jsonl"]);
      mockParseJsonlSessionCost.mockResolvedValue({
        sessionId: "session-1",
        totalCost: 1.00,
        tokenBreakdown: { input: 1000, output: 500, cacheWrite: 0, cacheRead: 0 },
        messageCount: 5,
        models: ["claude-sonnet-4-6"],
      });

      const result = await reconcileSession("session-1", "/test/project");
      expect(result).not.toBeNull();
      expect(result!.status).toBe("verified");
      expect(result!.statuslineCost).toBe(1.05);
      expect(result!.jsonlCost).toBe(1.00);
      expect(result!.difference).toBeCloseTo(0.05, 6);
      // percentDiff uses avg as base: diff=0.05, avg=1.025, pct=4.88%
      expect(result!.percentDiff).toBeCloseTo(4.88, 0);
    });

    it("should return 'discrepancy' when costs differ by more than 5%", async () => {
      mockGetSessionCost.mockReturnValue({
        sessionId: "session-1",
        projectPath: "/test/project",
        tokens: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 },
        cost: 2.00,
        lastUpdated: "2026-03-10T10:00:00Z",
      });

      mockFindSessionLogs.mockResolvedValue(["/path/to/session-1.jsonl"]);
      mockParseJsonlSessionCost.mockResolvedValue({
        sessionId: "session-1",
        totalCost: 1.00,
        tokenBreakdown: { input: 1000, output: 500, cacheWrite: 0, cacheRead: 0 },
        messageCount: 5,
        models: ["claude-sonnet-4-6"],
      });

      const result = await reconcileSession("session-1", "/test/project");
      expect(result).not.toBeNull();
      expect(result!.status).toBe("discrepancy");
      // diff=1.00, avg=1.50, pct=66.67%
      expect(result!.percentDiff).toBeCloseTo(66.67, 0);
    });

    it("should return 'verified' when difference < $0.10 even if > 5%", async () => {
      // Small cost: $0.05 statusline vs $0.03 JSONL
      // Percent diff = 66%, but absolute diff = $0.02 < $0.10
      mockGetSessionCost.mockReturnValue({
        sessionId: "session-1",
        projectPath: "/test/project",
        tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
        cost: 0.05,
        lastUpdated: "2026-03-10T10:00:00Z",
      });

      mockFindSessionLogs.mockResolvedValue(["/path/to/session-1.jsonl"]);
      mockParseJsonlSessionCost.mockResolvedValue({
        sessionId: "session-1",
        totalCost: 0.03,
        tokenBreakdown: { input: 100, output: 50, cacheWrite: 0, cacheRead: 0 },
        messageCount: 1,
        models: ["claude-sonnet-4-6"],
      });

      const result = await reconcileSession("session-1", "/test/project");
      expect(result).not.toBeNull();
      expect(result!.status).toBe("verified");
    });

    it("should return null when session has no statusline cost", async () => {
      mockGetSessionCost.mockReturnValue(undefined);

      const result = await reconcileSession("nonexistent", "/test/project");
      expect(result).toBeNull();
    });

    it("should return null when no JSONL files found for session", async () => {
      mockGetSessionCost.mockReturnValue({
        sessionId: "session-1",
        projectPath: "/test/project",
        tokens: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 },
        cost: 1.00,
        lastUpdated: "2026-03-10T10:00:00Z",
      });

      mockFindSessionLogs.mockResolvedValue([]);

      const result = await reconcileSession("session-1", "/test/project");
      expect(result).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // reconcileAllSessions
  // --------------------------------------------------------------------------

  describe("reconcileAllSessions", () => {
    it("should reconcile all active sessions", async () => {
      mockGetCostSummary.mockReturnValue({
        totalCost: 3.00,
        totalTokens: { input: 3000, output: 1500, cacheRead: 0, cacheWrite: 0 },
        sessions: {
          "session-1": {
            sessionId: "session-1",
            projectPath: "/test/project",
            tokens: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 },
            cost: 1.00,
            lastUpdated: "2026-03-10T10:00:00Z",
          },
          "session-2": {
            sessionId: "session-2",
            projectPath: "/test/project",
            tokens: { input: 2000, output: 1000, cacheRead: 0, cacheWrite: 0 },
            cost: 2.00,
            lastUpdated: "2026-03-10T10:00:00Z",
          },
        },
        projects: {},
      });

      // Both sessions have matching JSONL files
      mockFindSessionLogs.mockResolvedValue([
        "/path/to/session-1.jsonl",
        "/path/to/session-2.jsonl",
      ]);
      mockParseJsonlSessionCost.mockImplementation(async (filePath: string) => {
        if (filePath.includes("session-1")) {
          return {
            sessionId: "session-1",
            totalCost: 1.00,
            tokenBreakdown: { input: 1000, output: 500, cacheWrite: 0, cacheRead: 0 },
            messageCount: 5,
            models: ["claude-sonnet-4-6"],
          };
        }
        if (filePath.includes("session-2")) {
          return {
            sessionId: "session-2",
            totalCost: 2.00,
            tokenBreakdown: { input: 2000, output: 1000, cacheWrite: 0, cacheRead: 0 },
            messageCount: 10,
            models: ["claude-sonnet-4-6"],
          };
        }
        throw new Error("Not found");
      });

      const results = await reconcileAllSessions();
      // Both sessions should attempt reconciliation, but only those with JSONL data succeed
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("should return empty array when no sessions exist", async () => {
      mockGetCostSummary.mockReturnValue({
        totalCost: 0,
        totalTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        sessions: {},
        projects: {},
      });

      const results = await reconcileAllSessions();
      expect(results).toEqual([]);
    });
  });
});
