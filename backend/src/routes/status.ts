/**
 * Status route for the Adjutant API.
 *
 * Endpoints:
 * - GET /api/status - Get current gastown system status
 */

import { Router } from "express";
import { getStatus } from "../services/power-service.js";
import { success, internalError } from "../utils/responses.js";

export const statusRouter = Router();

/**
 * GET /api/status
 * Returns the current gastown system status including power state,
 * town info, operator info, infrastructure agents, and rig statuses.
 */
statusRouter.get("/", async (_req, res) => {
  const result = await getStatus();

  if (!result.success) {
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to get gastown status")
    );
  }

  return res.json(success(result.data));
});
