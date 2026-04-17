import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock dependencies before importing the router
vi.mock("../../src/services/projects-service.js", () => ({
  listProjects: vi.fn(),
}));

vi.mock("../../src/services/beads/index.js", () => ({
  getProjectOverview: vi.fn(),
  computeEpicProgress: vi.fn(),
  getRecentlyCompletedEpics: vi.fn(),
}));

vi.mock("../../src/services/agents-service.js", () => ({
  getAgents: vi.fn(),
}));

import { createOverviewRouter } from "../../src/routes/overview.js";
import { listProjects } from "../../src/services/projects-service.js";
import type { Project } from "../../src/services/projects-service.js";
import {
  getProjectOverview,
  computeEpicProgress,
  getRecentlyCompletedEpics,
} from "../../src/services/beads/index.js";
import { getAgents } from "../../src/services/agents-service.js";
import type { MessageStore } from "../../src/services/message-store.js";

const mockStore = {
  getUnreadCounts: vi.fn().mockReturnValue([]),
  getUnreadSummaries: vi.fn().mockReturnValue([]),
} as unknown as MessageStore;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/overview", createOverviewRouter(mockStore));
  return app;
}

function createMockProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "abcd1234",
    name: "test-project",
    path: "/Users/test/code/test-project",
    mode: "swarm",
    sessions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    hasBeads: true,
    ...overrides,
  };
}

describe("overview routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // GET /api/overview
  // ===========================================================================

  describe("GET /api/overview", () => {
    it("should return overview for a specific project via projectId param", async () => {
      const projects = [
        createMockProject({ id: "p1", name: "proj-a", hasBeads: true }),
        createMockProject({ id: "p2", name: "proj-b", hasBeads: true }),
      ];
      vi.mocked(listProjects).mockReturnValue({ success: true, data: projects });

      vi.mocked(getProjectOverview).mockResolvedValue({
        success: true,
        data: {
          open: [{ id: "t1", title: "Task 1", description: "", status: "open", priority: 1, type: "task", assignee: null, project: null, source: "proj-a", labels: [], createdAt: "2026-01-01", updatedAt: null }],
          inProgress: [],
          recentlyClosed: [],
        },
      });

      vi.mocked(computeEpicProgress).mockResolvedValue({
        success: true,
        data: [{ id: "e1", title: "Epic 1", status: "in_progress", totalChildren: 3, closedChildren: 1, completionPercent: 33, assignee: null }],
      });

      vi.mocked(getRecentlyCompletedEpics).mockResolvedValue({
        success: true,
        data: [],
      });

      vi.mocked(getAgents).mockResolvedValue({
        success: true,
        data: [{ id: "agent-1", name: "agent-1", type: "crew", project: "", status: "working" }],
      });

      (mockStore.getUnreadCounts as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockStore.getUnreadSummaries as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const response = await request(app).get("/api/overview?projectId=p1");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.projects).toHaveLength(2);
      expect(response.body.data.beads).toBeDefined();
      expect(response.body.data.epics).toBeDefined();
      expect(response.body.data.agents).toBeDefined();
      expect(response.body.data.unreadMessages).toBeDefined();
      // Only the requested project should be queried
      expect(getProjectOverview).toHaveBeenCalledTimes(1);
    });

    it("should only query the requested project via projectId, not others (adj-109, adj-162)", async () => {
      const projects = [
        createMockProject({ id: "p1", name: "requested-proj", hasBeads: true }),
        createMockProject({ id: "p2", name: "other-proj", hasBeads: true }),
        createMockProject({ id: "p3", name: "no-beads", hasBeads: false }),
      ];
      vi.mocked(listProjects).mockReturnValue({ success: true, data: projects });

      vi.mocked(getProjectOverview).mockResolvedValue({
        success: true,
        data: { open: [], inProgress: [], recentlyClosed: [] },
      });
      vi.mocked(computeEpicProgress).mockResolvedValue({ success: true, data: [] });
      vi.mocked(getRecentlyCompletedEpics).mockResolvedValue({ success: true, data: [] });
      vi.mocked(getAgents).mockResolvedValue({ success: true, data: [] });

      const response = await request(app).get("/api/overview?projectId=p1");

      expect(response.status).toBe(200);
      // Only the requested project with beads should trigger calls
      expect(getProjectOverview).toHaveBeenCalledTimes(1);
      expect(getProjectOverview).toHaveBeenCalledWith("/Users/test/code/test-project");
    });

    it("should return empty beads when no projectId is specified", async () => {
      const projects = [
        createMockProject({ id: "p1", name: "proj-a", hasBeads: true }),
      ];
      vi.mocked(listProjects).mockReturnValue({ success: true, data: projects });
      vi.mocked(getAgents).mockResolvedValue({ success: true, data: [] });

      const response = await request(app).get("/api/overview");

      expect(response.status).toBe(200);
      expect(response.body.data.beads).toEqual({ open: [], inProgress: [], recentlyClosed: [] });
      // No beads service calls when no projectId param
      expect(getProjectOverview).not.toHaveBeenCalled();
    });

    it("should return empty data when no projects exist", async () => {
      vi.mocked(listProjects).mockReturnValue({ success: true, data: [] });
      vi.mocked(getAgents).mockResolvedValue({ success: true, data: [] });

      const response = await request(app).get("/api/overview");

      expect(response.status).toBe(200);
      expect(response.body.data.projects).toEqual([]);
      expect(response.body.data.beads).toEqual({ open: [], inProgress: [], recentlyClosed: [] });
      expect(response.body.data.epics).toEqual({ inProgress: [], recentlyCompleted: [] });
    });

    it("should return 500 when listProjects fails", async () => {
      vi.mocked(listProjects).mockReturnValue({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "Disk read failed" },
      });

      const response = await request(app).get("/api/overview");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });

    it("should include agents with unread counts", async () => {
      vi.mocked(listProjects).mockReturnValue({ success: true, data: [] });
      vi.mocked(getAgents).mockResolvedValue({
        success: true,
        data: [
          { id: "agent-1", name: "agent-1", type: "crew", project: "", status: "working", currentTask: "building stuff" },
        ],
      });

      (mockStore.getUnreadCounts as ReturnType<typeof vi.fn>).mockReturnValue([
        { agentId: "agent-1", count: 5 },
      ]);
      (mockStore.getUnreadSummaries as ReturnType<typeof vi.fn>).mockReturnValue([
        { agentId: "agent-1", unreadCount: 5, latestBody: "hello" },
      ]);

      const response = await request(app).get("/api/overview");

      expect(response.status).toBe(200);
      expect(response.body.data.agents).toHaveLength(1);
      expect(response.body.data.agents[0].unreadCount).toBe(5);
      expect(response.body.data.agents[0].currentBead).toBe("building stuff");
    });

    it("should handle unexpected errors with 500", async () => {
      vi.mocked(listProjects).mockImplementation(() => {
        throw new Error("Unexpected crash");
      });

      const response = await request(app).get("/api/overview");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });
});
