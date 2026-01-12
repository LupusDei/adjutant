/**
 * Power routes for the gastown-boy API.
 *
 * Endpoints:
 * - GET  /api/power/status - Get current gastown status
 * - POST /api/power/up     - Start gastown (power up)
 * - POST /api/power/down   - Stop gastown (power down)
 */

import { Router } from "express";
import { powerUp, powerDown, getStatus } from "../services/power-service.js";
import { success, conflict, internalError } from "../utils/responses.js";

export const powerRouter = Router();

/**
 * GET /api/power/status
 * Get current gastown status including power state and agent info.
 */
powerRouter.get("/status", async (_req, res) => {
  const result = await getStatus();

  if (!result.success) {
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to get status")
    );
  }

  return res.json(success(result.data));
});

/**
 * POST /api/power/up
 * Start gastown. Returns 409 if already running.
 */
powerRouter.post("/up", async (_req, res) => {
  const result = await powerUp();

  if (!result.success) {
    if (result.error?.code === "ALREADY_RUNNING") {
      return res.status(409).json(conflict(result.error.message));
    }
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to start gastown")
    );
  }

  return res.json(success(result.data));
});

/**
 * POST /api/power/down
 * Stop gastown. Returns 409 if already stopped.
 */
powerRouter.post("/down", async (_req, res) => {
  const result = await powerDown();

  if (!result.success) {
    if (result.error?.code === "ALREADY_STOPPED") {
      return res.status(409).json(conflict(result.error.message));
    }
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to stop gastown")
    );
  }

  return res.json(success(result.data));
});
