/**
 * Status route for the Adjutant API.
 *
 * Endpoints:
 * - GET /api/status - Get current system status (mode-aware)
 */

import { Router } from "express";
import { getStatusProvider } from "../services/status/index.js";
import { success, internalError } from "../utils/responses.js";

export const statusRouter = Router();

/**
 * GET /api/status
 * Returns the current system status. Uses the appropriate
 * StatusProvider based on deployment mode:
 * - gastown: Full infrastructure status with power control
 * - standalone/swarm: Simple always-on status
 */
statusRouter.get("/", async (_req, res) => {
  const provider = getStatusProvider();
  const result = await provider.getStatus();

  if (!result.success) {
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to get system status")
    );
  }

  return res.json(success(result.data));
});
