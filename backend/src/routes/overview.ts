/**
 * Overview route for the Adjutant API.
 *
 * Endpoints:
 * - GET /api/overview - Overview scoped to the active project
 */

import { Router } from "express";
import { listProjects } from "../services/projects-service.js";
import {
  getProjectOverview,
  computeEpicProgress,
  getRecentlyCompletedEpics,
} from "../services/beads/index.js";
import type { BeadInfo, EpicProgress } from "../services/beads/index.js";
import { getAgents } from "../services/agents-service.js";
import type { MessageStore } from "../services/message-store.js";
import { success, internalError } from "../utils/responses.js";
import type Database from "better-sqlite3";

/**
 * Creates the overview router.
 * Requires the message store for unread counts/summaries.
 */
export function createOverviewRouter(store: MessageStore, db?: Database.Database): Router {
  const router = Router();

  // Prepare callsign_personas lookup if DB is available
  const callsignPersonaStmt = db?.prepare(
    "SELECT cp.persona_id, p.source FROM callsign_personas cp JOIN personas p ON cp.persona_id = p.id WHERE cp.callsign = ? COLLATE NOCASE",
  );

  /**
   * GET /api/overview
   * Overview scoped to the active project: beads, epics, agents, unread messages.
   *
   * Only queries beads from the active project (not all registered projects).
   * This prevents serial bd timeouts when many projects are registered (adj-109).
   */
  router.get("/", async (_req, res) => {
    try {
      const projectsResult = listProjects();

      if (!projectsResult.success || !projectsResult.data) {
        return res.status(500).json(
          internalError(projectsResult.error?.message ?? "Failed to list projects")
        );
      }

      const allProjects = projectsResult.data;

      // Scope beads queries to the active project only (adj-109).
      // Querying all registered projects causes serial bd timeouts.
      const activeProject = allProjects.find((p) => p.active && p.hasBeads);

      let openBeads: BeadInfo[] = [];
      let inProgressBeads: BeadInfo[] = [];
      let recentlyClosedBeads: BeadInfo[] = [];
      let inProgressEpics: EpicProgress[] = [];
      let recentlyCompletedEpics: EpicProgress[] = [];

      if (activeProject) {
        const [beadsResult, epicResult, recentEpicsResult] = await Promise.all([
          getProjectOverview(activeProject.path),
          computeEpicProgress(activeProject.path),
          getRecentlyCompletedEpics(activeProject.path, 5),
        ]);

        if (beadsResult.success && beadsResult.data) {
          openBeads = beadsResult.data.open;
          inProgressBeads = beadsResult.data.inProgress;
          recentlyClosedBeads = beadsResult.data.recentlyClosed;
        }

        if (epicResult.success && epicResult.data) {
          inProgressEpics = epicResult.data;
        }

        if (recentEpicsResult.success && recentEpicsResult.data) {
          recentlyCompletedEpics = recentEpicsResult.data;
        }
      }

      // Fetch agents and unread data (global, not per-project)
      const [agentsResult, unreadCounts, unreadSummaries] = await Promise.all([
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
        ? agentsResult.data.map((a) => {
            // Look up persona linkage via callsign_personas junction table
            let personaId: string | null = null;
            let personaSource: string | null = null;
            if (callsignPersonaStmt) {
              try {
                const row = callsignPersonaStmt.get(a.name) as { persona_id: string; source: string } | undefined;
                if (row) {
                  personaId = row.persona_id;
                  personaSource = row.source;
                }
              } catch {
                // Table may not exist yet if migration hasn't run — silently ignore
              }
            }

            return {
              id: a.id,
              name: a.name,
              status: a.status,
              project: a.project ?? null,
              currentBead: a.currentTask ?? null,
              unreadCount: unreadMap.get(a.id) ?? unreadMap.get(a.name) ?? 0,
              sessionId: a.sessionId ?? null,
              cost: a.cost ?? null,
              contextPercent: a.contextPercent ?? null,
              ...(personaId ? { personaId, personaSource } : {}),
            };
          })
        : [];

      return res.json(success({
        projects: allProjects.map((p) => ({
          id: p.id,
          name: p.name,
          path: p.path,
          active: p.active,
        })),
        beads: {
          open: openBeads.slice(0, 50),
          inProgress: inProgressBeads.slice(0, 20),
          recentlyClosed: recentlyClosedBeads.slice(0, 10),
        },
        epics: {
          inProgress: inProgressEpics.slice(0, 20),
          recentlyCompleted: recentlyCompletedEpics.slice(0, 10),
        },
        agents,
        unreadMessages: unreadSummaries,
      }));
    } catch (err) {
      return res.status(500).json(
        internalError(
          err instanceof Error ? err.message : "Failed to get global overview"
        )
      );
    }
  });

  return router;
}
