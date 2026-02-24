/**
 * Projects route for the Adjutant API.
 *
 * Endpoints:
 * - GET    /api/projects              - List all projects
 * - POST   /api/projects              - Create project (from path, clone URL, or empty)
 * - GET    /api/projects/:id          - Get single project
 * - GET    /api/projects/:id/overview - Get project overview (beads, epics, agents)
 * - POST   /api/projects/:id/activate - Activate a project
 * - DELETE /api/projects/:id          - Delete project registration (not files)
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
import {
  getProjectOverview,
  computeEpicProgress,
  getRecentlyCompletedEpics,
} from "../services/beads-service.js";
import type { EpicProgress } from "../services/beads-service.js";
import { getAgents } from "../services/agents-service.js";
import type { MessageStore } from "../services/message-store.js";
import { success, badRequest, notFound, internalError } from "../utils/responses.js";

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
 * Create a projects router bound to the given MessageStore.
 * The overview endpoint needs the store for unread counts.
 */
export function createProjectsRouter(store: MessageStore): Router {
  const router = Router();

  /**
   * GET /api/projects
   * List all registered projects.
   */
  router.get("/", (_req, res) => {
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
  router.get("/:id", (req, res) => {
    const { id } = req.params;

    // Skip if this looks like a sub-route (handled below)
    // Express routes are matched in order, so explicit sub-routes above take priority

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
   * GET /api/projects/:id/overview
   * Get aggregated project overview: beads, epics, agents.
   */
  router.get("/:id/overview", async (req, res) => {
    try {
      const { id } = req.params;
      const projectResult = getProject(id);

      if (!projectResult.success || !projectResult.data) {
        if (projectResult.error?.code === "NOT_FOUND") {
          return res.status(404).json(notFound("Project", id));
        }
        return res.status(500).json(
          internalError(projectResult.error?.message ?? "Failed to get project")
        );
      }

      const project = projectResult.data;

      // Fetch beads overview, epic progress, agents, and unread counts in parallel
      const [beadsResult, epicResult, recentEpicsResult, agentsResult, unreadCounts] =
        await Promise.all([
          getProjectOverview(project.path),
          computeEpicProgress(project.path),
          getRecentlyCompletedEpics(project.path, 5),
          getAgents(),
          Promise.resolve(store.getUnreadCounts()),
        ]);

      // Build unread count map: agentId -> count
      const unreadMap = new Map<string, number>();
      for (const uc of unreadCounts) {
        unreadMap.set(uc.agentId, uc.count);
      }

      // Transform agents to overview format
      const agents = (agentsResult.success && agentsResult.data)
        ? agentsResult.data.map((a) => ({
            id: a.id,
            name: a.name,
            status: a.status,
            currentBead: a.currentTask ?? null,
            unreadCount: unreadMap.get(a.id) ?? unreadMap.get(a.name) ?? 0,
            sessionId: a.sessionId ?? null,
          }))
        : [];

      const inProgressEpics: EpicProgress[] =
        (epicResult.success && epicResult.data) ? epicResult.data : [];

      const recentlyCompletedEpics: EpicProgress[] =
        (recentEpicsResult.success && recentEpicsResult.data) ? recentEpicsResult.data : [];

      return res.json(success({
        project: {
          id: project.id,
          name: project.name,
          path: project.path,
          active: project.active,
        },
        beads: beadsResult.success && beadsResult.data
          ? beadsResult.data
          : { open: [], inProgress: [], recentlyClosed: [] },
        epics: {
          inProgress: inProgressEpics,
          recentlyCompleted: recentlyCompletedEpics,
        },
        agents,
      }));
    } catch (err) {
      return res.status(500).json(
        internalError(
          err instanceof Error ? err.message : "Failed to get project overview"
        )
      );
    }
  });

  /**
   * POST /api/projects
   * Create a new project.
   */
  router.post("/", (req, res) => {
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
        return res.status(409).json(
          // conflict() helper exists but using internalError for consistency
          internalError(result.error!.message)
        );
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
  router.post("/discover", (_req, res) => {
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
  router.post("/:id/activate", (req, res) => {
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
  router.delete("/:id", (req, res) => {
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

  return router;
}
