/**
 * Cost API contract tests.
 *
 * These tests validate that actual HTTP responses from cost endpoints match
 * the declared Zod schemas in cost-contracts.ts. They catch the class of bug
 * where backend response shapes silently diverge from frontend/iOS type
 * definitions (adj-064, adj-067).
 *
 * Pattern: mock the service layer with realistic data shapes, hit the HTTP
 * endpoint via supertest, validate the full response body against the schema.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ============================================================================
// Mock services before importing routes
// ============================================================================

vi.mock("../../src/services/cost-tracker.js", () => ({
  getCostSummary: vi.fn(),
  getSessionCost: vi.fn(),
  getCostAlertThreshold: vi.fn(),
  setCostAlertThreshold: vi.fn(),
  upsertBudget: vi.fn(),
  getBudgets: vi.fn(),
  deleteBudget: vi.fn(),
  getBurnRate: vi.fn(),
  getBeadCost: vi.fn(),
  getEpicCost: vi.fn(),
}));

vi.mock("../../src/services/cost-reconciler.js", () => ({
  reconcileSession: vi.fn(),
  reconcileAllSessions: vi.fn(),
}));

import { costsRouter } from "../../src/routes/costs.js";
import {
  getCostSummary,
  getSessionCost,
  getCostAlertThreshold,
  setCostAlertThreshold,
  upsertBudget,
  getBudgets,
  deleteBudget,
  getBurnRate,
  getBeadCost,
  getEpicCost,
} from "../../src/services/cost-tracker.js";
import {
  reconcileSession,
  reconcileAllSessions,
} from "../../src/services/cost-reconciler.js";
import {
  CostSummaryResponseSchema,
  SessionCostResponseSchema,
  ProjectCostsResponseSchema,
  BurnRateResponseSchema,
  BudgetListResponseSchema,
  BudgetCreateResponseSchema,
  BudgetDeleteResponseSchema,
  BeadCostResponseSchema,
  ReconcileAllResponseSchema,
  ReconcileSessionResponseSchema,
  ThresholdGetResponseSchema,
  ThresholdPutResponseSchema,
  ApiErrorSchema,
} from "../../src/types/cost-contracts.js";

// ============================================================================
// Test fixtures — realistic data matching actual service return shapes
// ============================================================================

const MOCK_TOKENS = { input: 15000, output: 3200, cacheRead: 8000, cacheWrite: 1200 };

const MOCK_COST_ENTRY = {
  sessionId: "sess-abc123",
  projectPath: "/Users/dev/project",
  tokens: MOCK_TOKENS,
  cost: 0.42,
  lastUpdated: "2026-03-11T10:00:00.000Z",
  contextPercent: 35,
  agentId: "kerrigan",
  reconciliationStatus: "estimated" as const,
  jsonlCost: 0.44,
};

const MOCK_PROJECT_COST = {
  projectPath: "/Users/dev/project",
  totalCost: 0.42,
  totalTokens: MOCK_TOKENS,
  sessionCount: 1,
};

const MOCK_SUMMARY = {
  totalCost: 0.42,
  totalTokens: MOCK_TOKENS,
  sessions: { "sess-abc123": MOCK_COST_ENTRY },
  projects: { "/Users/dev/project": MOCK_PROJECT_COST },
};

const MOCK_BURN_RATE = {
  rate10m: 2.50,
  rate1h: 1.80,
  trend: "stable" as const,
};

const MOCK_BUDGET = {
  id: 1,
  scope: "project" as const,
  scopeId: "adjutant",
  budgetAmount: 50.00,
  warningPercent: 80,
  criticalPercent: 100,
  createdAt: "2026-03-10T00:00:00.000Z",
  updatedAt: "2026-03-10T00:00:00.000Z",
};

const MOCK_BEAD_COST = {
  beadId: "adj-064",
  totalCost: 1.25,
  sessions: [
    {
      sessionId: "sess-abc123",
      cost: 0.75,
      tokens: MOCK_TOKENS,
    },
    {
      sessionId: "sess-def456",
      cost: 0.50,
      tokens: { input: 8000, output: 1500, cacheRead: 4000, cacheWrite: 600 },
    },
  ],
  tokenBreakdown: { input: 23000, output: 4700, cacheRead: 12000, cacheWrite: 1800 },
};

const MOCK_RECONCILIATION = {
  sessionId: "sess-abc123",
  statuslineCost: 0.42,
  jsonlCost: 0.44,
  difference: 0.02,
  percentDiff: 4.76,
  status: "verified" as const,
};

// ============================================================================
// Test setup
// ============================================================================

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/costs", costsRouter);
  return app;
}

describe("Cost API contracts", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // GET /api/costs — Cost summary
  // ==========================================================================

  describe("GET /api/costs", () => {
    it("response matches CostSummaryResponseSchema", async () => {
      vi.mocked(getCostSummary).mockReturnValue(MOCK_SUMMARY);

      const res = await request(app).get("/api/costs");

      expect(res.status).toBe(200);
      const parsed = CostSummaryResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });

    it("includes all required CostEntry fields in sessions", async () => {
      vi.mocked(getCostSummary).mockReturnValue(MOCK_SUMMARY);

      const res = await request(app).get("/api/costs");
      const session = res.body.data.sessions["sess-abc123"];

      expect(session).toBeDefined();
      expect(session.sessionId).toBe("sess-abc123");
      expect(session.tokens).toEqual(MOCK_TOKENS);
      expect(typeof session.cost).toBe("number");
      expect(typeof session.lastUpdated).toBe("string");
    });
  });

  // ==========================================================================
  // GET /api/costs/sessions/:id — Single session cost
  // ==========================================================================

  describe("GET /api/costs/sessions/:id", () => {
    it("response matches SessionCostResponseSchema", async () => {
      vi.mocked(getSessionCost).mockReturnValue(MOCK_COST_ENTRY);

      const res = await request(app).get("/api/costs/sessions/sess-abc123");

      expect(res.status).toBe(200);
      const parsed = SessionCostResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });

    it("returns 404 with error schema when session not found", async () => {
      vi.mocked(getSessionCost).mockReturnValue(undefined);

      const res = await request(app).get("/api/costs/sessions/nonexistent");

      expect(res.status).toBe(404);
      const parsed = ApiErrorSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });
  });

  // ==========================================================================
  // GET /api/costs/projects — Per-project costs
  // ==========================================================================

  describe("GET /api/costs/projects", () => {
    it("response matches ProjectCostsResponseSchema", async () => {
      vi.mocked(getCostSummary).mockReturnValue(MOCK_SUMMARY);

      const res = await request(app).get("/api/costs/projects");

      expect(res.status).toBe(200);
      const parsed = ProjectCostsResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });
  });

  // ==========================================================================
  // GET /api/costs/threshold — Cost alert threshold
  // ==========================================================================

  describe("GET /api/costs/threshold", () => {
    it("response matches ThresholdGetResponseSchema", async () => {
      vi.mocked(getCostAlertThreshold).mockReturnValue(5.00);

      const res = await request(app).get("/api/costs/threshold");

      expect(res.status).toBe(200);
      const parsed = ThresholdGetResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });
  });

  // ==========================================================================
  // PUT /api/costs/threshold — Set cost alert threshold
  // ==========================================================================

  describe("PUT /api/costs/threshold", () => {
    it("response matches ThresholdPutResponseSchema", async () => {
      const res = await request(app)
        .put("/api/costs/threshold")
        .send({ threshold: 10.00 });

      expect(res.status).toBe(200);
      const parsed = ThresholdPutResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });

    it("returns 400 with error schema on invalid input", async () => {
      const res = await request(app)
        .put("/api/costs/threshold")
        .send({ threshold: -1 });

      expect(res.status).toBe(400);
      const parsed = ApiErrorSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });
  });

  // ==========================================================================
  // POST /api/costs/budget — Create budget
  // ==========================================================================

  describe("POST /api/costs/budget", () => {
    it("response matches BudgetCreateResponseSchema", async () => {
      vi.mocked(upsertBudget).mockReturnValue(MOCK_BUDGET);

      const res = await request(app)
        .post("/api/costs/budget")
        .send({ scope: "project", scopeId: "adjutant", amount: 50.00 });

      expect(res.status).toBe(200);
      const parsed = BudgetCreateResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });

    it("returns 400 with error schema on invalid input", async () => {
      const res = await request(app)
        .post("/api/costs/budget")
        .send({ scope: "invalid" });

      expect(res.status).toBe(400);
      const parsed = ApiErrorSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });
  });

  // ==========================================================================
  // GET /api/costs/budget — List budgets
  // ==========================================================================

  describe("GET /api/costs/budget", () => {
    it("response matches BudgetListResponseSchema", async () => {
      vi.mocked(getBudgets).mockReturnValue([MOCK_BUDGET]);

      const res = await request(app).get("/api/costs/budget");

      expect(res.status).toBe(200);
      const parsed = BudgetListResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });

    it("returns empty array when no budgets", async () => {
      vi.mocked(getBudgets).mockReturnValue([]);

      const res = await request(app).get("/api/costs/budget");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  // ==========================================================================
  // DELETE /api/costs/budget/:id — Delete budget
  // ==========================================================================

  describe("DELETE /api/costs/budget/:id", () => {
    it("response matches BudgetDeleteResponseSchema", async () => {
      vi.mocked(deleteBudget).mockReturnValue(true);

      const res = await request(app).delete("/api/costs/budget/1");

      expect(res.status).toBe(200);
      const parsed = BudgetDeleteResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });

    it("returns 404 with error schema when budget not found", async () => {
      vi.mocked(deleteBudget).mockReturnValue(false);

      const res = await request(app).delete("/api/costs/budget/999");

      expect(res.status).toBe(404);
      const parsed = ApiErrorSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });

    it("returns 400 with error schema for non-numeric ID", async () => {
      const res = await request(app).delete("/api/costs/budget/abc");

      expect(res.status).toBe(400);
      const parsed = ApiErrorSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });
  });

  // ==========================================================================
  // GET /api/costs/burn-rate — Burn rate
  // ==========================================================================

  describe("GET /api/costs/burn-rate", () => {
    it("response matches BurnRateResponseSchema", async () => {
      vi.mocked(getBurnRate).mockReturnValue(MOCK_BURN_RATE);

      const res = await request(app).get("/api/costs/burn-rate");

      expect(res.status).toBe(200);
      const parsed = BurnRateResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });

    it("trend field is a valid enum value", async () => {
      vi.mocked(getBurnRate).mockReturnValue(MOCK_BURN_RATE);

      const res = await request(app).get("/api/costs/burn-rate");

      expect(["increasing", "stable", "decreasing"]).toContain(res.body.data.trend);
    });
  });

  // ==========================================================================
  // GET /api/costs/by-bead/:id — Bead cost
  // ==========================================================================

  describe("GET /api/costs/by-bead/:id", () => {
    it("response matches BeadCostResponseSchema", async () => {
      vi.mocked(getBeadCost).mockReturnValue(MOCK_BEAD_COST);

      const res = await request(app).get("/api/costs/by-bead/adj-064");

      expect(res.status).toBe(200);
      const parsed = BeadCostResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });

    it("epic cost with children matches BeadCostResponseSchema", async () => {
      vi.mocked(getEpicCost).mockReturnValue(MOCK_BEAD_COST);

      const res = await request(app)
        .get("/api/costs/by-bead/adj-064")
        .query({ children: "adj-064.1,adj-064.2" });

      expect(res.status).toBe(200);
      const parsed = BeadCostResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });

    it("returns 404 with error schema when bead not found", async () => {
      vi.mocked(getBeadCost).mockReturnValue(undefined);

      const res = await request(app).get("/api/costs/by-bead/adj-999");

      expect(res.status).toBe(404);
      const parsed = ApiErrorSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });
  });

  // ==========================================================================
  // GET /api/costs/reconcile — Reconcile all sessions
  // ==========================================================================

  describe("GET /api/costs/reconcile", () => {
    it("response matches ReconcileAllResponseSchema", async () => {
      vi.mocked(reconcileAllSessions).mockResolvedValue([MOCK_RECONCILIATION]);

      const res = await request(app).get("/api/costs/reconcile");

      expect(res.status).toBe(200);
      const parsed = ReconcileAllResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });

    it("returns empty array when no sessions to reconcile", async () => {
      vi.mocked(reconcileAllSessions).mockResolvedValue([]);

      const res = await request(app).get("/api/costs/reconcile");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  // ==========================================================================
  // GET /api/costs/reconcile/:sessionId — Reconcile single session
  // ==========================================================================

  describe("GET /api/costs/reconcile/:sessionId", () => {
    it("response matches ReconcileSessionResponseSchema", async () => {
      vi.mocked(getSessionCost).mockReturnValue(MOCK_COST_ENTRY);
      vi.mocked(reconcileSession).mockResolvedValue(MOCK_RECONCILIATION);

      const res = await request(app).get("/api/costs/reconcile/sess-abc123");

      expect(res.status).toBe(200);
      const parsed = ReconcileSessionResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });

    it("returns 404 when session not found", async () => {
      vi.mocked(getSessionCost).mockReturnValue(undefined);

      const res = await request(app).get("/api/costs/reconcile/nonexistent");

      expect(res.status).toBe(404);
      const parsed = ApiErrorSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });

    it("returns 404 when JSONL data not found", async () => {
      vi.mocked(getSessionCost).mockReturnValue(MOCK_COST_ENTRY);
      vi.mocked(reconcileSession).mockResolvedValue(undefined as unknown as null);

      const res = await request(app).get("/api/costs/reconcile/sess-abc123");

      expect(res.status).toBe(404);
    });
  });
});
