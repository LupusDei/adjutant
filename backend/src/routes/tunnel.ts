/**
 * Tunnel routes for the Adjutant API.
 *
 * Endpoints:
 * - GET  /api/tunnel/status - Get current tunnel status
 * - POST /api/tunnel/start  - Start the ngrok tunnel
 * - POST /api/tunnel/stop   - Stop the ngrok tunnel
 */

import { Router } from "express";
import { getStatus, startTunnel, stopTunnel } from "../services/tunnel-service.js";
import { success, conflict, internalError } from "../utils/responses.js";

export const tunnelRouter = Router();

/**
 * GET /api/tunnel/status
 * Get current tunnel status including state and public URL.
 */
tunnelRouter.get("/status", async (_req, res) => {
  const result = await getStatus();

  if (!result.success) {
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to get tunnel status")
    );
  }

  return res.json(success(result.data));
});

/**
 * POST /api/tunnel/start
 * Start the ngrok tunnel. Returns 409 if already running.
 */
tunnelRouter.post("/start", async (_req, res) => {
  const result = await startTunnel();

  if (!result.success) {
    if (result.error?.code === "ALREADY_RUNNING") {
      return res.status(409).json(conflict(result.error.message));
    }
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to start tunnel")
    );
  }

  return res.json(success(result.data));
});

/**
 * POST /api/tunnel/stop
 * Stop the ngrok tunnel. Returns 409 if already stopped.
 */
tunnelRouter.post("/stop", async (_req, res) => {
  const result = await stopTunnel();

  if (!result.success) {
    if (result.error?.code === "ALREADY_STOPPED") {
      return res.status(409).json(conflict(result.error.message));
    }
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to stop tunnel")
    );
  }

  return res.json(success(result.data));
});
