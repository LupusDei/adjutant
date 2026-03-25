/**
 * Beads route for the Adjutant API.
 *
 * Endpoints:
 * - GET /api/beads - List beads for the project
 * - GET /api/beads/graph - Get dependency graph of all beads
 * - GET /api/beads/:id - Get detailed info for a single bead
 * - PATCH /api/beads/:id - Update a bead's status
 */

import { Router } from "express";
import { z } from "zod";
import { listBeads, listAllBeads, updateBead, getBead, getEpicChildren, listEpicsWithProgress, listBeadSources, listRecentlyClosed, getBeadsGraph, type BeadStatus, type BeadSortField, VALID_SORT_FIELDS } from "../services/beads/index.js";
import { BeadsGraphResponseSchema } from "../types/beads.js";
import { resolveProjectPath } from "../services/workspace/index.js";
import { listProjects, getProject } from "../services/projects-service.js";
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
 * - project: Scope which database(s) to query. Options:
 *   - "town": Query only town (hq-*) database (default)
 *   - "all": Query all databases (town + all projects)
 *   - "<project-name>": Query only that project's database (e.g., "adjutant")
 * - projectId: Resolve a registered project by ID (takes precedence over `project` name param)
 * - status: Status filter. Options:
 *   - "default": Shows open + in_progress + blocked (active work)
 *   - "open", "in_progress", "blocked", "deferred", "closed": Single status
 *   - "open,in_progress,blocked": Comma-separated list
 *   - "all": Shows everything
 *   Default: "default" (active work only)
 * - type: Filter by bead type (e.g., "task", "bug", "feature")
 * - limit: Max results (default: 500)
 * - excludeTown: Set to "true" to exclude hq- town beads when project=all (default: false)
 * - sort: Sort field for bd list (priority, created, updated, closed, status, id, title, type, assignee)
 * - order: Sort order ("asc" or "desc", default: "asc")
 */
beadsRouter.get("/", async (req, res) => {
  const projectParam = req.query["project"] as string | undefined;
  const projectIdParam = req.query["projectId"] as string | undefined;
  const statusParam = req.query["status"] as string | undefined;
  const typeParam = req.query["type"] as string | undefined;
  const limitStr = req.query["limit"] as string | undefined;
  const assigneeParam = req.query["assignee"] as string | undefined;
  const excludeTown = req.query["excludeTown"] === "true";
  const sortParam = req.query["sort"] as string | undefined;
  const orderParam = req.query["order"] as string | undefined;
  // Higher default to show low-priority bugs (P3) which sort to the end
  const limit = limitStr ? parseInt(limitStr, 10) : 500;

  // Validate sort field against allowed values
  const sort = sortParam && (VALID_SORT_FIELDS as readonly string[]).includes(sortParam)
    ? sortParam as BeadSortField
    : undefined;
  const order: "asc" | "desc" | undefined = orderParam === "desc" ? "desc" : orderParam === "asc" ? "asc" : undefined;

  // Default to showing active work (open + in_progress + blocked)
  const status = statusParam ?? "default";

  // Resolve projectId (by ID) — takes precedence over project name param
  let projectIdPath: string | undefined;
  if (projectIdParam) {
    const projectResult = getProject(projectIdParam);
    if (projectResult.success && projectResult.data) {
      projectIdPath = projectResult.data.path;
    }
  }

  // Normalize project parameter: undefined/empty defaults to "town"
  const project = projectParam?.trim() || "town";

  // project=all: Query ALL beads databases (town + all projects)
  // (projectId does not apply to "all" mode — it selects a specific project)
  if (!projectIdPath && project === "all") {
    const excludePrefixes = excludeTown ? ["hq-"] : [];
    const result = await listAllBeads({
      ...(typeParam && { type: typeParam }),
      ...(assigneeParam && { assignee: assigneeParam }),
      ...(sort && { sort }),
      ...(order && { order }),
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

  // project=town or project=<specific>: Query single database
  // For "town", query the town database directly (no projectPath needed)
  // For other projects, resolve their path (check workspace projects, then registered projects)
  // projectId resolution takes precedence if it succeeded
  let projectPath: string | undefined = projectIdPath;
  if (!projectPath && project !== "town") {
    projectPath = resolveProjectPath(project) ?? undefined;

    // If workspace project resolution failed, check registered projects by name
    if (!projectPath) {
      const projectsResult = listProjects();
      if (projectsResult.success && projectsResult.data) {
        const proj = projectsResult.data.find((p) => p.name === project);
        if (proj) {
          projectPath = proj.path;
        }
      }
    }
  }

  const result = await listBeads({
    // Don't pass project for filtering - we want all beads from the database
    ...(projectPath && { projectPath }),
    ...(typeParam && { type: typeParam }),
    ...(assigneeParam && { assignee: assigneeParam }),
    ...(sort && { sort }),
    ...(order && { order }),
    status,
    limit,
  });

  if (!result.success) {
    // For explicit project selection (by name or ID), surface the error so the client
    // can show a meaningful message (e.g., corrupted beads database)
    if (project !== "town" || projectIdPath) {
      return res.status(500).json(
        internalError(result.error?.message ?? "Failed to load beads for project")
      );
    }
    // Default town view: graceful degradation — return empty
    return res.json(success([]));
  }

  return res.json(success(result.data));
});

/**
 * GET /api/beads/sources
 * Returns available bead sources (projects) and current deployment mode.
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
 * GET /api/beads/recent-closed
 * Returns beads closed within a configurable time window.
 *
 * Query params:
 * - hours: Time window in hours (default: 1, max: 24)
 *
 * Response:
 * - { success: true, data: RecentlyClosedBead[] }
 *
 * IMPORTANT: This route MUST be registered before /:id to prevent
 * Express from matching "recent-closed" as a bead ID parameter.
 */
beadsRouter.get("/recent-closed", async (req, res) => {
  const hoursStr = req.query["hours"] as string | undefined;
  const projectParam = req.query["project"] as string | undefined;
  let hours = hoursStr ? parseInt(hoursStr, 10) : 1;

  // Clamp to valid range (1-24)
  if (isNaN(hours) || hours < 1) hours = 1;
  if (hours > 24) hours = 24;

  const result = await listRecentlyClosed(hours, projectParam);

  if (!result.success) {
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to list recently closed beads")
    );
  }

  return res.json(success(result.data));
});

/**
 * GET /api/beads/graph
 * Returns the dependency graph of all beads as { nodes, edges }.
 *
 * IMPORTANT: This route MUST be registered before /:id to prevent
 * Express from matching "graph" as a bead ID parameter.
 *
 * Query params:
 * - project: "town" (default), "all", or a specific project name
 * - projectId: Resolve a registered project by ID (takes precedence over `project` name param)
 * - status: "default" (default), "open", "in_progress", "blocked", "closed", "all"
 * - type: Filter by bead type (e.g., "epic", "task", "bug")
 * - epicId: Filter to a specific epic's sub-tree (server-side: returns epic, parent, and all descendants)
 * - excludeTown: "true" to exclude hq-* beads when project=all (default: false)
 *
 * Response:
 * - { success: true, data: { nodes: GraphNode[], edges: GraphDependency[] } }
 */
beadsRouter.get("/graph", async (req, res) => {
  const projectParam = req.query["project"] as string | undefined;
  const projectIdParam = req.query["projectId"] as string | undefined;
  const statusParam = req.query["status"] as string | undefined;
  const typeParam = req.query["type"] as string | undefined;
  const epicIdParam = req.query["epicId"] as string | undefined;
  const excludeTown = req.query["excludeTown"] === "true";

  // Resolve projectId to project name (takes precedence over project name param)
  let resolvedProject = projectParam;
  if (projectIdParam) {
    const projectResult = getProject(projectIdParam);
    if (projectResult.success && projectResult.data) {
      resolvedProject = projectResult.data.name;
    }
  }

  const result = await getBeadsGraph({
    project: resolvedProject,
    status: statusParam,
    type: typeParam,
    epicId: epicIdParam,
    excludeTown,
  });

  if (!result.success) {
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to build beads graph")
    );
  }

  // Runtime validation of response shape using Zod (per code style rules)
  const validated = BeadsGraphResponseSchema.safeParse(result.data);
  if (!validated.success) {
    return res.status(500).json(
      internalError("Graph response validation failed: " + validated.error.message)
    );
  }

  return res.json(success(validated.data));
});

/**
 * GET /api/beads/epics-with-progress
 * Returns all epics with server-computed progress using the dependency graph.
 * Eliminates the need for frontend to fetch all beads for progress calculation.
 *
 * IMPORTANT: This route MUST be registered before /:id to prevent
 * Express from matching "epics-with-progress" as a bead ID parameter.
 *
 * Query params:
 * - status: Filter epics by status (default: "all")
 *
 * Response:
 * - { success: true, data: EpicWithChildren[] }
 */
beadsRouter.get("/epics-with-progress", async (req, res) => {
  const statusParam = req.query["status"] as string | undefined;
  const projectParam = req.query["project"] as string | undefined;

  const result = await listEpicsWithProgress({
    status: statusParam ?? "all",
    ...(projectParam && { project: projectParam }),
  });

  if (!result.success) {
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to list epics with progress")
    );
  }

  return res.json(success(result.data));
});

/**
 * GET /api/beads/:id/children
 * Returns all children of a bead using the dependency graph (`bd children`).
 * Use this for epic detail pages instead of fetching all beads.
 *
 * Path params:
 * - id: Full bead ID (e.g., "adj-020")
 *
 * Response:
 * - { success: true, data: BeadInfo[] }
 */
beadsRouter.get("/:id/children", async (req, res) => {
  const beadId = req.params.id;

  if (!beadId) {
    return res.status(400).json(badRequest("Bead ID is required"));
  }

  const result = await getEpicChildren(beadId);

  if (!result.success) {
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to get children")
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
  const beadId = req.params.id;
  const projectParam = req.query["project"] as string | undefined;

  if (!beadId) {
    return res.status(400).json(badRequest("Bead ID is required"));
  }

  const result = await getBead(beadId, {
    ...(projectParam && { project: projectParam }),
  });

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
  const beadId = req.params.id;

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
