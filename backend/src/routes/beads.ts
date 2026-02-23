/**
 * Beads route for the Adjutant API.
 *
 * Endpoints:
 * - GET /api/beads - List beads for the rig
 * - GET /api/beads/:id - Get detailed info for a single bead
 * - PATCH /api/beads/:id - Update a bead's status
 */

import { Router } from "express";
import { z } from "zod";
import { listBeads, listAllBeads, updateBead, getBead, listBeadSources, type BeadStatus } from "../services/beads-service.js";
import { resolveRigPath } from "../services/workspace/index.js";
import { listProjects } from "../services/projects-service.js";
import { success, internalError, badRequest } from "../utils/responses.js";

/** Zod schema for PATCH /api/beads/:id request body */
const beadUpdateSchema = z.object({
  status: z.string().min(1).optional(),
  assignee: z.string().min(1).optional(),
}).refine(data => data.status !== undefined || data.assignee !== undefined, {
  message: "At least one of 'status' or 'assignee' is required",
});

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
  const assigneeParam = req.query["assignee"] as string | undefined;
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
      ...(assigneeParam && { assignee: assigneeParam }),
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
    ...(assigneeParam && { assignee: assigneeParam }),
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
 * Updates a bead's status and/or assignee.
 *
 * Path params:
 * - id: Full bead ID (e.g., "hq-vts8", "gb-53tj")
 *
 * Request body:
 * - status?: New status value (open, in_progress, blocked, closed, etc.)
 * - assignee?: Agent name to assign the bead to
 *
 * At least one of status or assignee must be provided.
 *
 * Response:
 * - { success: true, data: { id: string, status?: string, assignee?: string } }
 */
beadsRouter.patch("/:id", async (req, res) => {
  const beadId = req.params["id"];

  if (!beadId) {
    return res.status(400).json(badRequest("Bead ID is required"));
  }

  const parsed = beadUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => i.message).join("; ");
    return res.status(400).json(badRequest(msg));
  }

  const { status, assignee } = parsed.data;

  const result = await updateBead(beadId, {
    ...(status ? { status: status as BeadStatus } : {}),
    ...(assignee ? { assignee } : {}),
  });

  if (!result.success) {
    const code = result.error?.code;
    const statusCode = (code === "INVALID_STATUS" || code === "INVALID_REQUEST") ? 400 : 500;
    return res.status(statusCode).json(
      statusCode === 400
        ? badRequest(result.error?.message ?? "Invalid request")
        : internalError(result.error?.message ?? "Failed to update bead")
    );
  }

  return res.json(success(result.data));
});
