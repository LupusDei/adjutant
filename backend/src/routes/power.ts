/**
 * Power routes for the Adjutant API.
 *
 * Endpoints:
 * - GET  /api/power/status       - Get current system status
 * - GET  /api/power/capabilities - Get power control capabilities
 * - POST /api/power/up           - Start system (power up) - if supported
 * - POST /api/power/down         - Stop system (power down) - if supported
 */

import { Router } from "express";
import { getStatusProvider } from "../services/status/index.js";
import { success, conflict, internalError, badRequest } from "../utils/responses.js";

export const powerRouter = Router();

/**
 * GET /api/power/status
 * Get current system status including power state and agent info.
 */
powerRouter.get("/status", async (_req, res) => {
  const provider = getStatusProvider();
  const result = await provider.getStatus();

  if (!result.success) {
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to get status")
    );
  }

  return res.json(success(result.data));
});

/**
 * GET /api/power/capabilities
 * Get power control capabilities for the current deployment.
 */
powerRouter.get("/capabilities", (_req, res) => {
  const provider = getStatusProvider();
  const capabilities = provider.getPowerCapabilities();
  return res.json(success(capabilities));
});

/**
 * POST /api/power/up
 * Start system. Returns 409 if already running, 400 if not supported.
 */
powerRouter.post("/up", async (_req, res) => {
  const provider = getStatusProvider();

  if (!provider.hasPowerControl()) {
    return res.status(400).json(
      badRequest("Power control is not available in this deployment mode")
    );
  }

  const result = await provider.powerUp();

  if (!result.success) {
    if (result.error?.code === "ALREADY_RUNNING") {
      return res.status(409).json(conflict(result.error.message));
    }
    if (result.error?.code === "NOT_SUPPORTED") {
      return res.status(400).json(badRequest(result.error.message));
    }
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to start system")
    );
  }

  return res.json(success(result.data));
});

/**
 * POST /api/power/down
 * Stop system. Returns 409 if already stopped, 400 if not supported.
 */
powerRouter.post("/down", async (_req, res) => {
  const provider = getStatusProvider();

  if (!provider.hasPowerControl()) {
    return res.status(400).json(
      badRequest("Power control is not available in this deployment mode")
    );
  }

  const result = await provider.powerDown();

  if (!result.success) {
    if (result.error?.code === "ALREADY_STOPPED") {
      return res.status(409).json(conflict(result.error.message));
    }
    if (result.error?.code === "NOT_SUPPORTED") {
      return res.status(400).json(badRequest(result.error.message));
    }
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to stop system")
    );
  }

  return res.json(success(result.data));
});
