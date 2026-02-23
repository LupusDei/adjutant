/**
 * Beads route for the Adjutant API.
 *
 * Endpoints:
 * - GET /api/beads - List beads for the rig
 * - GET /api/beads/:id - Get detailed info for a single bead
 * - PATCH /api/beads/:id - Update a bead's status
 */

import { Router } from "express";
import { listBeads, listAllBeads, updateBeadStatus, getBead, listBeadSources, type BeadStatus } from "../services/beads-service.js";
import { resolveRigPath } from "../services/workspace/index.js";
import { listProjects } from "../services/projects-service.js";
import { success, internalError, badRequest } from "../utils/responses.js";

export const beadsRouter = Router();

/**
 * GET /api/beads
 * Returns beads for the beads tab.
 *
 * Query params:
 * - rig: Scope which database(s) to query. Options:
 *   - "town": Query only town (hq-*) database (default)
 *   - "all": Query all databases (town + all rigs)
 *   - "<rig-name>": Query only that rig's database (e.g., "adjutant")
 * - status: Status filter. Options:
 *   - "default": Shows open + in_progress + blocked (active work)
 *   - "open", "in_progress", "blocked", "deferred", "closed": Single status
 *   - "open,in_progress,blocked": Comma-separated list
 *   - "all": Shows everything
 *   Default: "default" (active work only)
 * - type: Filter by bead type (e.g., "task", "bug", "feature")
 * - limit: Max results (default: 500)
 * - excludeTown: Set to "true" to exclude hq- town beads when rig=all (default: false)
 */
beadsRouter.get("/", async (req, res) => {
  const rigParam = req.query["rig"] as string | undefined;
  const statusParam = req.query["status"] as string | undefined;
  const typeParam = req.query["type"] as string | undefined;
  const limitStr = req.query["limit"] as string | undefined;
  const excludeTown = req.query["excludeTown"] === "true";
  // Higher default to show low-priority bugs (P3) which sort to the end
  const limit = limitStr ? parseInt(limitStr, 10) : 500;

  // Default to showing active work (open + in_progress + blocked)
  const status = statusParam ?? "default";

  // Normalize rig parameter: undefined/empty defaults to "town"
  const rig = rigParam?.trim() || "town";

  // rig=all: Query ALL beads databases (town + all rigs)
  if (rig === "all") {
    const excludePrefixes = excludeTown ? ["hq-"] : [];
    const result = await listAllBeads({
      ...(typeParam && { type: typeParam }),
      status,
      limit,
      excludePrefixes,
    });

    if (!result.success) {
      // Graceful degradation: return empty when bd unavailable
      return res.json(success([]));
    }

    return res.json(success(result.data));
  }

  // rig=town or rig=<specific>: Query single database
  // For "town", query the town database directly (no rigPath needed)
  // For other rigs, resolve their path (check workspace rigs, then registered projects)
  let rigPath: string | undefined;
  if (rig !== "town") {
    rigPath = resolveRigPath(rig) ?? undefined;

    // If workspace rig resolution failed, check registered projects by name
    if (!rigPath) {
      const projectsResult = listProjects();
      if (projectsResult.success && projectsResult.data) {
        const project = projectsResult.data.find((p) => p.name === rig);
        if (project) {
          rigPath = project.path;
        }
      }
    }
  }

  const result = await listBeads({
    // Don't pass rig for filtering - we want all beads from the database
    ...(rigPath && { rigPath }),
    ...(typeParam && { type: typeParam }),
    status,
    limit,
  });

  if (!result.success) {
    // Graceful degradation: return empty when bd unavailable
    return res.json(success([]));
  }

  return res.json(success(result.data));
});

/**
 * GET /api/beads/sources
 * Returns available bead sources (projects/rigs) and current deployment mode.
 * Used by the frontend to populate filter dropdowns.
 */
beadsRouter.get("/sources", async (_req, res) => {
  const result = await listBeadSources();

  if (!result.success) {
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to list bead sources")
    );
  }

  return res.json(success(result.data));
});

/**
 * GET /api/beads/:id
 * Returns detailed information about a single bead.
 *
 * Path params:
 * - id: Full bead ID (e.g., "hq-vts8", "adj-67tta")
 *
 * Response:
 * - { success: true, data: BeadDetail }
 */
beadsRouter.get("/:id", async (req, res) => {
  const beadId = req.params["id"];

  if (!beadId) {
    return res.status(400).json(badRequest("Bead ID is required"));
  }

  const result = await getBead(beadId);

  if (!result.success) {
    const statusCode = result.error?.code === "BEAD_NOT_FOUND" ? 404 : 500;
    return res.status(statusCode).json(
      statusCode === 404
        ? badRequest(result.error?.message ?? "Bead not found")
        : internalError(result.error?.message ?? "Failed to get bead")
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
