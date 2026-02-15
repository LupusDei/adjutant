/**
 * Costs route for the Adjutant API.
 *
 * Endpoints:
 * - GET    /api/costs              - Get full cost summary
 * - GET    /api/costs/sessions/:id - Get cost for a specific session
 * - GET    /api/costs/projects     - Get per-project cost aggregation
 * - GET    /api/costs/threshold    - Get cost alert threshold
 * - PUT    /api/costs/threshold    - Set cost alert threshold
 */

import { Router } from "express";
import { z } from "zod";
import {
  getCostSummary,
  getSessionCost,
  getCostAlertThreshold,
  setCostAlertThreshold,
} from "../services/cost-tracker.js";
import { success, notFound, validationError } from "../utils/index.js";

export const costsRouter = Router();

const ThresholdSchema = z.object({
  threshold: z.number().min(0),
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
