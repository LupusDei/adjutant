/**
 * Beads route for the gastown-boy API.
 *
 * Endpoints:
 * - GET /api/beads - List beads for the rig
 */

import { Router } from "express";
import { listBeads } from "../services/beads-service.js";
import { success, internalError } from "../utils/responses.js";

export const beadsRouter = Router();

/**
 * GET /api/beads
 * Returns beads filtered by rig for the beads tab.
 *
 * Query params:
 * - rig: Filter by rig (default: gastown_boy)
 * - status: "open" | "closed" | "all" (default: open)
 * - limit: Max results (default: 100)
 */
beadsRouter.get("/", async (req, res) => {
  const rig = (req.query["rig"] as string) ?? "gastown_boy";
  const statusParam = req.query["status"] as "open" | "closed" | "all" | undefined;
  const limitStr = req.query["limit"] as string | undefined;
  const limit = limitStr ? parseInt(limitStr, 10) : 100;

  const result = await listBeads({
    rig,
    limit,
    ...(statusParam && { status: statusParam }),
  });

  if (!result.success) {
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to list beads")
    );
  }

  return res.json(success(result.data));
});
