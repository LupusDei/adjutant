/**
 * Projects route for the Adjutant API.
 *
 * Endpoints:
 * - GET    /api/projects          - List all projects
 * - POST   /api/projects          - Create project (from path, clone URL, or empty)
 * - GET    /api/projects/:id      - Get single project
 * - POST   /api/projects/:id/activate - Activate a project
 * - DELETE /api/projects/:id      - Delete project registration (not files)
 */

import { Router } from "express";
import { z } from "zod";
import {
  listProjects,
  getProject,
  createProject,
  activateProject,
  deleteProject,
  discoverLocalProjects,
} from "../services/projects-service.js";
import { success, badRequest, notFound, internalError, conflict } from "../utils/responses.js";

export const projectsRouter = Router();

/**
 * GET /api/projects
 * List all registered projects.
 */
projectsRouter.get("/", (_req, res) => {
  const result = listProjects();

  if (!result.success) {
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to list projects")
    );
  }

  return res.json(success(result.data));
});

/**
 * GET /api/projects/:id
 * Get a single project by ID.
 */
projectsRouter.get("/:id", (req, res) => {
  const { id } = req.params;
  const result = getProject(id);

  if (!result.success) {
    if (result.error?.code === "NOT_FOUND") {
      return res.status(404).json(notFound("Project", id));
    }
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to get project")
    );
  }

  return res.json(success(result.data));
});

/**
 * Zod schema for project creation.
 */
const createProjectSchema = z.object({
  path: z.string().min(1).optional(),
  cloneUrl: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  empty: z.boolean().optional(),
}).refine(
  (data) => data.path || data.cloneUrl || (data.empty && data.name),
  { message: "Must provide path, cloneUrl, or empty with name" }
);

/**
 * POST /api/projects
 * Create a new project.
 */
projectsRouter.post("/", (req, res) => {
  const parsed = createProjectSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json(
      badRequest(parsed.error.issues[0]?.message ?? "Invalid request")
    );
  }

  const result = createProject(parsed.data);

  if (!result.success) {
    const code = result.error?.code;
    if (code === "VALIDATION_ERROR") {
      return res.status(400).json(badRequest(result.error!.message));
    }
    if (code === "CONFLICT") {
      return res.status(409).json(conflict(result.error!.message));
    }
    if (code === "CLI_ERROR") {
      return res.status(500).json(internalError(result.error!.message));
    }
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to create project")
    );
  }

  return res.status(201).json(success(result.data));
});

/**
 * POST /api/projects/discover
 * Scan the project root for git repos and auto-register them.
 */
projectsRouter.post("/discover", (_req, res) => {
  const result = discoverLocalProjects();

  if (!result.success) {
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to discover projects")
    );
  }

  const discovered = result.data ?? [];
  const allResult = listProjects();
  return res.json(success({
    discovered: discovered.length,
    projects: allResult.success ? allResult.data : discovered,
  }));
});

/**
 * POST /api/projects/:id/activate
 * Activate a project as the current project.
 */
projectsRouter.post("/:id/activate", (req, res) => {
  const { id } = req.params;
  const result = activateProject(id);

  if (!result.success) {
    if (result.error?.code === "NOT_FOUND") {
      return res.status(404).json(notFound("Project", id));
    }
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to activate project")
    );
  }

  return res.json(success(result.data));
});

/**
 * DELETE /api/projects/:id
 * Remove project registration. Does NOT delete files on disk.
 */
projectsRouter.delete("/:id", (req, res) => {
  const { id } = req.params;
  const result = deleteProject(id);

  if (!result.success) {
    if (result.error?.code === "NOT_FOUND") {
      return res.status(404).json(notFound("Project", id));
    }
    return res.status(500).json(
      internalError(result.error?.message ?? "Failed to delete project")
    );
  }

  return res.json(success(result.data));
});
