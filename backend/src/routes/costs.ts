/**
 * Costs route for the Adjutant API.
 *
 * Endpoints:
 * - GET    /api/costs              - Get full cost summary
 * - GET    /api/costs/sessions/:id - Get cost for a specific session
 * - GET    /api/costs/projects     - Get per-project cost aggregation
 * - GET    /api/costs/threshold    - Get cost alert threshold
 * - PUT    /api/costs/threshold    - Set cost alert threshold
 * - POST   /api/costs/budget      - Create/update a budget
 * - GET    /api/costs/budget       - Get all budgets with status
 * - DELETE /api/costs/budget/:id   - Delete a budget
 * - GET    /api/costs/burn-rate    - Get current burn rate
 * - GET    /api/costs/by-bead/:id  - Get cost for a specific bead
 */

import { Router } from "express";
import { z } from "zod";
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
} from "../services/cost-tracker.js";
import { success, notFound, validationError } from "../utils/index.js";

export const costsRouter = Router();

const ThresholdSchema = z.object({
  threshold: z.number().min(0),
});

const BudgetSchema = z.object({
  scope: z.enum(["session", "project"]),
  scopeId: z.string().optional(),
  amount: z.number().min(0),
  warningPercent: z.number().min(0).max(100).optional(),
  criticalPercent: z.number().min(0).max(200).optional(),
});

/**
 * GET /api/costs
 * Get full cost summary.
 */
costsRouter.get("/", (_req, res) => {
  const summary = getCostSummary();
  return res.json(success(summary));
});

/**
 * GET /api/costs/sessions/:id
 * Get cost for a specific session.
 */
costsRouter.get("/sessions/:id", (req, res) => {
  const cost = getSessionCost(req.params.id);
  if (!cost) {
    return res.status(404).json(notFound("Session cost", req.params.id));
  }
  return res.json(success(cost));
});

/**
 * GET /api/costs/projects
 * Get per-project cost aggregation.
 */
costsRouter.get("/projects", (_req, res) => {
  const summary = getCostSummary();
  return res.json(success(Object.values(summary.projects)));
});

/**
 * GET /api/costs/threshold
 * Get the cost alert threshold.
 */
costsRouter.get("/threshold", (_req, res) => {
  return res.json(success({ threshold: getCostAlertThreshold() }));
});

/**
 * PUT /api/costs/threshold
 * Set the cost alert threshold.
 */
costsRouter.put("/threshold", (req, res) => {
  const parsed = ThresholdSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json(validationError("Invalid request", parsed.error.message));
  }

  setCostAlertThreshold(parsed.data.threshold);
  return res.json(success({ threshold: parsed.data.threshold }));
});

/**
 * POST /api/costs/budget
 * Create or update a budget.
 */
costsRouter.post("/budget", (req, res) => {
  const parsed = BudgetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json(validationError("Invalid request", parsed.error.message));
  }

  // Build the options object, only including defined properties
  const opts: Parameters<typeof upsertBudget>[0] = {
    scope: parsed.data.scope,
    amount: parsed.data.amount,
  };
  if (parsed.data.scopeId !== undefined) opts.scopeId = parsed.data.scopeId;
  if (parsed.data.warningPercent !== undefined) opts.warningPercent = parsed.data.warningPercent;
  if (parsed.data.criticalPercent !== undefined) opts.criticalPercent = parsed.data.criticalPercent;
  const budget = upsertBudget(opts);
  if (!budget) {
    return res.status(500).json({ success: false, error: { code: "BUDGET_ERROR", message: "Failed to create budget" } });
  }
  return res.json(success(budget));
});

/**
 * GET /api/costs/budget
 * Get all budgets with their current status.
 */
costsRouter.get("/budget", (_req, res) => {
  const budgets = getBudgets();
  return res.json(success(budgets));
});

/**
 * DELETE /api/costs/budget/:id
 * Delete a budget.
 */
costsRouter.delete("/budget/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json(validationError("Invalid budget ID", "ID must be a number"));
  }
  const deleted = deleteBudget(id);
  if (!deleted) {
    return res.status(404).json(notFound("Budget", String(id)));
  }
  return res.json(success({ deleted: true }));
});

/**
 * GET /api/costs/burn-rate
 * Get current burn rate calculation.
 */
costsRouter.get("/burn-rate", (_req, res) => {
  const rate = getBurnRate();
  return res.json(success(rate));
});

/**
 * GET /api/costs/by-bead/:id
 * Get aggregated cost for a specific bead.
 * Query param: ?children=id1,id2,id3 for epic aggregation.
 */
costsRouter.get("/by-bead/:id", (req, res) => {
  const beadId = req.params.id;
  const childrenParam = req.query["children"] as string | undefined;

  let result;
  if (childrenParam) {
    const childIds = childrenParam.split(",").map((s) => s.trim()).filter(Boolean);
    result = getEpicCost(beadId, childIds);
  } else {
    result = getBeadCost(beadId);
  }

  if (!result) {
    return res.status(404).json(notFound("Bead cost", beadId));
  }
  return res.json(success(result));
});
