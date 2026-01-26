/**
 * Beads route for the Adjutant API.
 *
 * Endpoints:
 * - GET /api/beads - List beads for the rig
 */

import { Router } from "express";
import { listBeads, listAllBeads, updateBeadStatus, type BeadStatus } from "../services/beads-service.js";
import { resolveTownRoot, resolveRigPath } from "../services/gastown-workspace.js";
import { success, internalError, badRequest } from "../utils/responses.js";

export const beadsRouter = Router();

/**
 * GET /api/beads
 * Returns beads for the beads tab.
 *
 * IMPORTANT: Adjutant is the dashboard for ALL of Gas Town.
 * By default, we show ALL beads from the town, not filtered by rig.
 * See .claude/rules/00-critical-scope.md for context.
 *
 * Query params:
 * - rig: Filter by rig (optional - omit to show all beads)
 * - status: Status filter. Options:
 *   - "default": Shows open + in_progress + blocked (active work)
 *   - "open", "in_progress", "blocked", "deferred", "closed": Single status
 *   - "open,in_progress,blocked": Comma-separated list
 *   - "all": Shows everything
 *   Default: "default" (active work only)
 * - type: Filter by bead type (e.g., "task", "bug", "feature")
 * - limit: Max results (default: 100)
 * - excludeTown: Set to "true" to exclude hq- town beads (default: false - shows all)
 */
beadsRouter.get("/", async (req, res) => {
  const rig = req.query["rig"] as string | undefined;
  const statusParam = req.query["status"] as string | undefined;
  const typeParam = req.query["type"] as string | undefined;
  const limitStr = req.query["limit"] as string | undefined;
  const excludeTown = req.query["excludeTown"] === "true";
  // Higher default to show low-priority bugs (P3) which sort to the end
  const limit = limitStr ? parseInt(limitStr, 10) : 500;

  // Default to showing active work (open + in_progress + blocked)
  const status = statusParam ?? "default";

  // Include hq- town beads by default (Adjutant is the dashboard for ALL of Gas Town)
  const excludePrefixes = excludeTown ? ["hq-"] : [];

  // If no rig specified, fetch from ALL beads databases
  if (!rig) {
    const result = await listAllBeads({
      ...(typeParam && { type: typeParam }),
      status,
      limit,
      excludePrefixes,
    });

    if (!result.success) {
      return res.status(500).json(
        internalError(result.error?.message ?? "Failed to list beads")
      );
    }

    return res.json(success(result.data));
  }

  // Rig specified - fetch from that rig's database only
  const townRoot = resolveTownRoot();
  const rigPath = resolveRigPath(rig, townRoot) ?? undefined;

  const result = await listBeads({
    rig,
    ...(rigPath && { rigPath }),
    ...(typeParam && { type: typeParam }),
    status,
    limit,
  });

  if (!result.success) {
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to list beads")
    );
  }

  return res.json(success(result.data));
});

/**
 * PATCH /api/beads/:id
 * Updates a bead's status.
 *
 * Path params:
 * - id: Full bead ID (e.g., "hq-vts8", "gb-53tj")
 *
 * Request body:
 * - status: New status value (backlog, open, in_progress, testing, merging, complete, closed, etc.)
 *
 * Response:
 * - { success: true, data: { id: string, status: string } }
 */
beadsRouter.patch("/:id", async (req, res) => {
  const beadId = req.params["id"];
  const { status } = req.body as { status?: string };

  if (!beadId) {
    return res.status(400).json(badRequest("Bead ID is required"));
  }

  if (!status) {
    return res.status(400).json(badRequest("Status is required in request body"));
  }

  const result = await updateBeadStatus(beadId, status as BeadStatus);

  if (!result.success) {
    const statusCode = result.error?.code === "INVALID_STATUS" ? 400 : 500;
    return res.status(statusCode).json(
      statusCode === 400
        ? badRequest(result.error?.message ?? "Invalid request")
        : internalError(result.error?.message ?? "Failed to update bead")
    );
  }

  return res.json(success(result.data));
});
