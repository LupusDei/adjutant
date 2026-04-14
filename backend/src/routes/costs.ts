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
 * - GET    /api/costs/export       - Export cost data as CSV
 * - GET    /api/costs/projections  - Get cost projections and trend data
 * - GET    /api/costs/reconcile    - Reconcile all active sessions
 * - GET    /api/costs/reconcile/:sessionId - Reconcile a specific session
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
  getCostExportRows,
  getCostProjection,
} from "../services/cost-tracker.js";
import { reconcileSession, reconcileAllSessions } from "../services/cost-reconciler.js";
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

/**
 * GET /api/costs/export
 * Export cost data as CSV.
 * Query params: agentId, beadId, startDate, endDate
 */
costsRouter.get("/export", (req, res) => {
  const agentId = req.query["agentId"] as string | undefined;
  const beadId = req.query["beadId"] as string | undefined;
  const startDate = req.query["startDate"] as string | undefined;
  const endDate = req.query["endDate"] as string | undefined;

  const filters: Parameters<typeof getCostExportRows>[0] = {};
  if (agentId) filters.agentId = agentId;
  if (beadId) filters.beadId = beadId;
  if (startDate) filters.startDate = startDate;
  if (endDate) filters.endDate = endDate;

  const rows = getCostExportRows(filters);

  // CSV header
  const header = "session_id,agent_id,bead_id,project_path,cost,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,recorded_at";

  // CSV rows — escape fields that may contain commas or quotes
  const csvRows = rows.map((row) => {
    const fields = [
      row.sessionId,
      row.agentId,
      row.beadId,
      row.projectPath,
      row.cost.toFixed(4),
      String(row.inputTokens),
      String(row.outputTokens),
      String(row.cacheReadTokens),
      String(row.cacheWriteTokens),
      row.recordedAt,
    ];
    return fields.map((f) => {
      // Quote fields containing commas, quotes, or newlines
      if (f.includes(",") || f.includes('"') || f.includes("\n")) {
        return `"${f.replace(/"/g, '""')}"`;
      }
      return f;
    }).join(",");
  });

  const csv = [header, ...csvRows].join("\n");

  const filename = `adjutant-costs-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(csv);
});

/**
 * GET /api/costs/projections
 * Get cost projections and trend data.
 * Query param: percentComplete (0-100) for completion estimate.
 */
costsRouter.get("/projections", (req, res) => {
  const percentStr = req.query["percentComplete"] as string | undefined;
  let percentComplete: number | undefined;

  if (percentStr) {
    const parsed = parseFloat(percentStr);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
      percentComplete = parsed;
    }
  }

  const projection = getCostProjection(percentComplete);
  return res.json(success(projection));
});

/**
 * GET /api/costs/reconcile
 * Reconcile all active sessions against JSONL data.
 */
costsRouter.get("/reconcile", async (_req, res) => {
  try {
    const results = await reconcileAllSessions();
    return res.json(success(results));
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: "RECONCILE_ERROR", message: String(err) },
    });
  }
});

/**
 * GET /api/costs/reconcile/:sessionId
 * Reconcile a specific session against JSONL data.
 */
costsRouter.get("/reconcile/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const sessionCost = getSessionCost(sessionId);
  if (!sessionCost) {
    return res.status(404).json(notFound("Session cost", sessionId));
  }

  try {
    const result = await reconcileSession(sessionId, sessionCost.projectPath);
    if (!result) {
      return res.status(404).json(notFound("JSONL data for session", sessionId));
    }
    return res.json(success(result));
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: "RECONCILE_ERROR", message: String(err) },
    });
  }
});
