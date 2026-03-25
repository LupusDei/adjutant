/**
 * Projects route for the Adjutant API.
 *
 * Endpoints:
 * - GET    /api/projects              - List all projects
 * - POST   /api/projects              - Create project (from path, clone URL, or empty)
 * - POST   /api/projects/discover     - Scan for and auto-register projects
 * - GET    /api/projects/:id/files      - List directory contents within a project
 * - GET    /api/projects/:id/files/read - Read a file's content within a project
 * - GET    /api/projects/:id          - Get single project
 * - GET    /api/projects/:id/overview - Get project overview (beads, epics, agents)
 * - GET    /api/projects/:id/health   - Check project health (path, git, beads)
 * - POST   /api/projects/:id/activate - Activate a project
 * - PATCH  /api/projects/:id          - Update project settings (autoDevelop, visionContext)
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
  checkProjectHealth,
  enableAutoDevelop,
  disableAutoDevelop,
  setVisionContext,
} from "../services/projects-service.js";
import { listDirectory, readFile } from "../services/files-service.js";
import {
  getProjectOverview,
  computeEpicProgress,
  getRecentlyCompletedEpics,
} from "../services/beads/index.js";
import type { EpicProgress } from "../services/beads/index.js";
import { getAgents } from "../services/agents-service.js";
import type { MessageStore } from "../services/message-store.js";
import { success, error as errorResponse, badRequest, notFound, internalError } from "../utils/responses.js";
import { UpdateProjectAutoDevelopSchema } from "../types/auto-develop.js";
import type { AutoDevelopStatus } from "../types/auto-develop.js";
import { getEventBus } from "../services/event-bus.js";
import type { ProposalStore } from "../services/proposal-store.js";
import type { AutoDevelopStore } from "../services/auto-develop-store.js";

/**
 * Zod schema for file listing query params.
 */
const listFilesSchema = z.object({
  path: z.string().optional().default(""),
});

/**
 * Zod schema for file read query params.
 */
const readFileSchema = z.object({
  path: z.string().min(1, "File path is required"),
});

/**
 * Zod schema for project creation.
 */
const createProjectSchema = z.object({
  path: z.string().min(1).optional(),
  cloneUrl: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  empty: z.boolean().optional(),
  /** Target directory for clone operations. Overrides default ~/projects/<name>. */
  targetDir: z.string().min(1).optional(),
}).refine(
  (data) => data.path || data.cloneUrl || (data.empty && data.name),
  { message: "Must provide path, cloneUrl, or empty with name" }
);

/**
 * Create a projects router bound to the given MessageStore.
 * The overview endpoint needs the store for unread counts.
 */
export function createProjectsRouter(store: MessageStore, proposalStore?: ProposalStore, autoDevelopStore?: AutoDevelopStore): Router {
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
   * GET /api/projects/:id/files
   * List directory contents within a project.
   * Query params: ?path=relative/path (default: project root)
   */
  router.get("/:id/files", async (req, res) => {
    const { id } = req.params;
    const parsed = listFilesSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json(
        badRequest(parsed.error.issues[0]?.message ?? "Invalid request"),
      );
    }

    const result = await listDirectory(id, parsed.data.path);
    if (!result.success) {
      if (result.error?.code === "NOT_FOUND") {
        return res.status(404).json(notFound("Directory", parsed.data.path));
      }
      return res.status(400).json(
        badRequest(result.error?.message ?? "Failed to list directory"),
      );
    }

    return res.json(success(result.data));
  });

  /**
   * GET /api/projects/:id/files/read
   * Read a file's content within a project.
   * Query params: ?path=relative/path/to/file.md
   */
  router.get("/:id/files/read", async (req, res) => {
    const { id } = req.params;
    const parsed = readFileSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json(
        badRequest(parsed.error.issues[0]?.message ?? "Invalid request"),
      );
    }

    const result = await readFile(id, parsed.data.path);
    if (!result.success) {
      if (result.error?.code === "NOT_FOUND") {
        return res.status(404).json(notFound("File", parsed.data.path));
      }
      // adj-wyvo: return 415 for unsupported file types
      if (result.error?.code === "UNSUPPORTED_TYPE") {
        return res.status(415).json(
          errorResponse("UNSUPPORTED_TYPE", result.error.message),
        );
      }
      return res.status(400).json(
        badRequest(result.error?.message ?? "Failed to read file"),
      );
    }

    return res.json(success(result.data));
  });

  /**
   * GET /api/projects/:id/auto-develop
   * Get auto-develop status for a project.
   */
  router.get("/:id/auto-develop", (req, res) => {
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
    if (!project.autoDevelop) {
      return res.status(400).json(badRequest("Auto-develop is not enabled for this project"));
    }

    // Get proposal counts by status
    // ProposalStatus is "pending" | "accepted" | "dismissed" | "completed"
    // escalated = pending proposals with confidence score in 40-59 range
    const projectIds = [project.id, project.name];
    const pendingProposals = proposalStore?.getProposals({ status: "pending", project: projectIds }) ?? [];
    const escalated = pendingProposals.filter(p => p.confidenceScore !== undefined && p.confidenceScore >= 40 && p.confidenceScore < 60).length;
    const inReview = pendingProposals.length - escalated;
    const accepted = proposalStore?.getProposals({ status: "accepted", project: projectIds }).length ?? 0;
    const dismissed = proposalStore?.getProposals({ status: "dismissed", project: projectIds }).length ?? 0;

    // Get cycle stats
    const activeCycle = autoDevelopStore?.getActiveCycle(project.id) ?? null;
    const cycleHistory = autoDevelopStore?.getCycleHistory(project.id) ?? [];
    const completedCycles = cycleHistory.filter(c => c.completedAt !== null).length;

    const status: AutoDevelopStatus = {
      enabled: project.autoDevelop,
      paused: !!project.autoDevelopPausedAt,
      pausedAt: project.autoDevelopPausedAt ?? null,
      currentPhase: activeCycle ? (activeCycle.phase as AutoDevelopStatus["currentPhase"]) : null,
      activeCycleId: activeCycle?.id ?? null,
      visionContext: project.visionContext ?? null,
      proposals: { inReview, accepted, escalated, dismissed },
      epicsInExecution: accepted,
      cycleStats: {
        totalCycles: cycleHistory.length,
        completedCycles,
      },
    };

    return res.json(success(status));
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

      // Fetch beads overview, epic progress, agents, unread counts, and unread summaries in parallel
      const [beadsResult, epicResult, recentEpicsResult, agentsResult, unreadCounts, unreadSummaries] =
        await Promise.all([
          getProjectOverview(project.path),
          computeEpicProgress(project.path),
          getRecentlyCompletedEpics(project.path, 5),
          getAgents(),
          Promise.resolve(store.getUnreadCounts()),
          Promise.resolve(store.getUnreadSummaries(8)),
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
        unreadMessages: unreadSummaries,
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
   * Scan the project root for git repos and beads repos and auto-register them.
   * Accepts optional { maxDepth: number } in body (default 1, max 3).
   */
  router.post("/discover", (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const maxDepth = typeof body?.["maxDepth"] === "number"
      ? body["maxDepth"]
      : undefined;
    const result = discoverLocalProjects(maxDepth !== undefined ? { maxDepth } : undefined);

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
   * GET /api/projects/:id/health
   * Check health of a registered project (path exists, git valid, beads present).
   */
  router.get("/:id/health", (req, res) => {
    const { id } = req.params;
    const result = checkProjectHealth(id);

    if (!result.success) {
      if (result.error?.code === "NOT_FOUND") {
        return res.status(404).json(notFound("Project", id));
      }
      return res.status(500).json(
        internalError(result.error?.message ?? "Failed to check project health")
      );
    }

    return res.json(success(result.data));
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
   * PATCH /api/projects/:id
   * Update project settings (currently: autoDevelop toggle + visionContext).
   */
  router.patch("/:id", (req, res) => {
    const { id } = req.params;
    const parsed = UpdateProjectAutoDevelopSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(badRequest(parsed.error.issues[0]?.message ?? "Invalid request"));
    }

    // Get existing project first
    const existing = getProject(id);
    if (!existing.success || !existing.data) {
      return res.status(404).json(notFound("Project", id));
    }

    let result: ReturnType<typeof enableAutoDevelop> | undefined;

    if (parsed.data.autoDevelop === true) {
      result = enableAutoDevelop(id);
      if (result.success) {
        const enabledEvent: { projectId: string; projectName: string; visionContext?: string } = {
          projectId: id,
          projectName: existing.data.name,
        };
        if (parsed.data.visionContext !== undefined) {
          enabledEvent.visionContext = parsed.data.visionContext;
        }
        getEventBus().emit("project:auto_develop_enabled", enabledEvent);
      }
    } else if (parsed.data.autoDevelop === false) {
      result = disableAutoDevelop(id);
      if (result.success) {
        getEventBus().emit("project:auto_develop_disabled", {
          projectId: id,
          projectName: existing.data.name,
        });
      }
    }

    // Early return if the autoDevelop toggle failed — don't fall through to visionContext
    if (result && !result.success) {
      return res.status(500).json(internalError(result.error?.message ?? "Failed to update project"));
    }

    if (parsed.data.visionContext !== undefined) {
      result = setVisionContext(id, parsed.data.visionContext);
    }

    if (!result) {
      return res.status(400).json(badRequest("No update fields provided"));
    }

    if (!result.success) {
      return res.status(500).json(internalError(result.error?.message ?? "Failed to update project"));
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
