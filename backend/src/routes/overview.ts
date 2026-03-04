/**
 * Global overview route for the Adjutant API.
 *
 * Endpoints:
 * - GET /api/overview - Aggregated overview across all registered projects
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

/**
 * Creates the overview router.
 * Requires the message store for unread counts/summaries.
 */
export function createOverviewRouter(store: MessageStore): Router {
  const router = Router();

  /**
   * GET /api/overview
   * Get aggregated overview across all projects: beads, epics, agents, unread messages.
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

      // Only query beads for projects that have a .beads directory
      const beadsProjects = allProjects.filter((p) => p.hasBeads);

      // Fetch per-project beads data in parallel using Promise.allSettled
      const perProjectResults = await Promise.allSettled(
        beadsProjects.map(async (project) => {
          const [beadsResult, epicResult, recentEpicsResult] = await Promise.all([
            getProjectOverview(project.path),
            computeEpicProgress(project.path),
            getRecentlyCompletedEpics(project.path, 5),
          ]);
          return { beadsResult, epicResult, recentEpicsResult };
        })
      );

      // Aggregate beads and epics from all projects
      const allOpen: BeadInfo[] = [];
      const allInProgress: BeadInfo[] = [];
      const allRecentlyClosed: BeadInfo[] = [];
      const allInProgressEpics: EpicProgress[] = [];
      const allRecentlyCompletedEpics: EpicProgress[] = [];

      for (const result of perProjectResults) {
        if (result.status !== "fulfilled") continue;
        const { beadsResult, epicResult, recentEpicsResult } = result.value;

        if (beadsResult.success && beadsResult.data) {
          allOpen.push(...beadsResult.data.open);
          allInProgress.push(...beadsResult.data.inProgress);
          allRecentlyClosed.push(...beadsResult.data.recentlyClosed);
        }

        if (epicResult.success && epicResult.data) {
          allInProgressEpics.push(...epicResult.data);
        }

        if (recentEpicsResult.success && recentEpicsResult.data) {
          allRecentlyCompletedEpics.push(...recentEpicsResult.data);
        }
      }

      // Sort aggregated results by recency and apply limits
      allRecentlyClosed.sort((a, b) => {
        const aDate = a.updatedAt ?? a.createdAt;
        const bDate = b.updatedAt ?? b.createdAt;
        return bDate.localeCompare(aDate);
      });
      allInProgressEpics.sort((a, b) => b.completionPercent - a.completionPercent);
      allRecentlyCompletedEpics.sort((a, b) => {
        const aDate = a.closedAt ?? "";
        const bDate = b.closedAt ?? "";
        return bDate.localeCompare(aDate);
      });

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
        ? agentsResult.data.map((a) => ({
            id: a.id,
            name: a.name,
            status: a.status,
            project: a.project ?? null,
            currentBead: a.currentTask ?? null,
            unreadCount: unreadMap.get(a.id) ?? unreadMap.get(a.name) ?? 0,
            sessionId: a.sessionId ?? null,
          }))
        : [];

      return res.json(success({
        projects: allProjects.map((p) => ({
          id: p.id,
          name: p.name,
          path: p.path,
          active: p.active,
        })),
        beads: {
          open: allOpen.slice(0, 50),
          inProgress: allInProgress.slice(0, 20),
          recentlyClosed: allRecentlyClosed.slice(0, 10),
        },
        epics: {
          inProgress: allInProgressEpics.slice(0, 20),
          recentlyCompleted: allRecentlyCompletedEpics.slice(0, 10),
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
