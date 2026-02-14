/**
 * Mode route for the Adjutant API.
 *
 * Endpoints:
 * - GET  /api/mode - Get current mode, features, and available transitions
 * - POST /api/mode - Switch deployment mode at runtime
 */

import { Router } from "express";
import { getModeInfo, switchMode } from "../services/mode-service.js";
import type { DeploymentMode } from "../services/workspace/index.js";
import { success, badRequest, internalError } from "../utils/responses.js";

export const modeRouter = Router();

/**
 * GET /api/mode
 * Returns current mode, available features, and valid mode transitions.
 */
modeRouter.get("/", (_req, res) => {
  try {
    const info = getModeInfo();
    return res.json(success(info));
  } catch (err) {
    return res.status(500).json(
      internalError(err instanceof Error ? err.message : "Failed to get mode info")
    );
  }
});

/**
 * POST /api/mode
 * Switch deployment mode at runtime.
 * Body: { mode: "gastown" | "standalone" | "swarm" }
 */
modeRouter.post("/", (req, res) => {
  const { mode } = req.body as { mode?: string };

  if (!mode) {
    return res.status(400).json(badRequest("Missing required field: mode"));
  }

  const validModes: DeploymentMode[] = ["gastown", "standalone", "swarm"];
  if (!validModes.includes(mode as DeploymentMode)) {
    return res.status(400).json(
      badRequest(`Invalid mode: ${mode}. Valid modes: ${validModes.join(", ")}`)
    );
  }

  try {
    const result = switchMode(mode as DeploymentMode);

    if (!result.success) {
      return res.status(400).json(
        badRequest(result.error?.message ?? "Failed to switch mode")
      );
    }

    return res.json(success(result.data));
  } catch (err) {
    return res.status(500).json(
      internalError(err instanceof Error ? err.message : "Failed to switch mode")
    );
  }
});
