/**
 * Overview API contract tests.
 *
 * Validates the aggregated overview response shape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ============================================================================
// Mocks
// ============================================================================

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
import {
  getProjectOverview,
  computeEpicProgress,
  getRecentlyCompletedEpics,
} from "../../src/services/beads/index.js";
import { getAgents } from "../../src/services/agents-service.js";
import { OverviewResponseSchema } from "../../src/types/beads-contracts.js";

// ============================================================================
// Mock message store
// ============================================================================

const mockStore = {
  getUnreadCounts: vi.fn().mockReturnValue([]),
  getUnreadSummaries: vi.fn().mockReturnValue([]),
};

// ============================================================================
// Fixtures
// ============================================================================

const MOCK_PROJECT = { id: "adjutant", name: "adjutant", path: "/code/adjutant", hasBeads: true };

const MOCK_BEAD = {
  id: "adj-042", title: "Task", description: "", status: "open",
  priority: 1, type: "task", assignee: null, project: "adjutant",
  source: "adj", labels: [], createdAt: "2026-03-10T00:00:00Z", updatedAt: null,
};

const MOCK_EPIC_PROGRESS = {
  id: "adj-001", title: "Epic", status: "in_progress",
  totalChildren: 5, closedChildren: 3, completionPercent: 60,
  assignee: "kerrigan", closedAt: null,
};

// ============================================================================
// Tests
// ============================================================================

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/overview", createOverviewRouter(mockStore as any));
  return app;
}

describe("Overview API contracts", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
    mockStore.getUnreadCounts.mockReturnValue([]);
    mockStore.getUnreadSummaries.mockReturnValue([]);
  });

  describe("GET /api/overview", () => {
    it("response matches OverviewResponseSchema", async () => {
      vi.mocked(listProjects).mockReturnValue({ success: true, data: [MOCK_PROJECT] });
      vi.mocked(getProjectOverview).mockResolvedValue({
        success: true,
        data: { open: [MOCK_BEAD], inProgress: [], recentlyClosed: [] },
      });
      vi.mocked(computeEpicProgress).mockResolvedValue({ success: true, data: [MOCK_EPIC_PROGRESS] });
      vi.mocked(getRecentlyCompletedEpics).mockResolvedValue({ success: true, data: [] });
      vi.mocked(getAgents).mockResolvedValue({ success: true, data: [] });

      const res = await request(app).get("/api/overview?projectId=adjutant");

      expect(res.status).toBe(200);
      const parsed = OverviewResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });

    it("includes all required top-level fields", async () => {
      vi.mocked(listProjects).mockReturnValue({ success: true, data: [] });
      vi.mocked(getAgents).mockResolvedValue({ success: true, data: [] });

      const res = await request(app).get("/api/overview");

      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data).toHaveProperty("projects");
      expect(data).toHaveProperty("beads");
      expect(data).toHaveProperty("epics");
      expect(data).toHaveProperty("agents");
      expect(data).toHaveProperty("unreadMessages");
    });

    it("agents array includes cost and contextPercent fields", async () => {
      vi.mocked(listProjects).mockReturnValue({ success: true, data: [] });
      vi.mocked(getAgents).mockResolvedValue({
        success: true,
        data: [{
          id: "adj/kerrigan", name: "kerrigan", type: "agent", project: "adjutant",
          status: "working" as const, currentTask: "Working on adj-042",
          sessionId: "sess-123", cost: 1.25, contextPercent: 45,
        }],
      });
      mockStore.getUnreadCounts.mockReturnValue([{ agentId: "adj/kerrigan", count: 2 }]);

      const res = await request(app).get("/api/overview");

      const agent = res.body.data.agents[0];
      expect(agent.cost).toBe(1.25);
      expect(agent.contextPercent).toBe(45);
      expect(agent.unreadCount).toBe(2);
    });
  });
});
