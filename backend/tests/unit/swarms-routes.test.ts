import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock the swarm service
const mockCreateSwarm = vi.fn();
const mockAddAgentToSwarm = vi.fn();
const mockRemoveAgentFromSwarm = vi.fn();
const mockGetSwarmStatus = vi.fn();
const mockListSwarms = vi.fn();
const mockDestroySwarm = vi.fn();
const mockGetSwarmBranches = vi.fn();
const mockMergeAgentBranch = vi.fn();

vi.mock("../../src/services/swarm-service.js", () => ({
  createSwarm: (...args: unknown[]) => mockCreateSwarm(...args),
  addAgentToSwarm: (...args: unknown[]) => mockAddAgentToSwarm(...args),
  removeAgentFromSwarm: (...args: unknown[]) => mockRemoveAgentFromSwarm(...args),
  getSwarmStatus: (...args: unknown[]) => mockGetSwarmStatus(...args),
  listSwarms: (...args: unknown[]) => mockListSwarms(...args),
  destroySwarm: (...args: unknown[]) => mockDestroySwarm(...args),
  getSwarmBranches: (...args: unknown[]) => mockGetSwarmBranches(...args),
  mergeAgentBranch: (...args: unknown[]) => mockMergeAgentBranch(...args),
}));

// Mock agents-service for /active endpoint
const mockGetAgents = vi.fn();
vi.mock("../../src/services/agents-service.js", () => ({
  getAgents: (...args: unknown[]) => mockGetAgents(...args),
}));

import { swarmsRouter } from "../../src/routes/swarms.js";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/swarms", swarmsRouter);
  // Error handler prevents "socket hang up" flakiness in supertest
  app.use(((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ success: false, error: { message: err.message } });
  }) as express.ErrorRequestHandler);
  return app;
}

describe("swarms routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // GET /api/swarms
  // ==========================================================================

  describe("GET /api/swarms", () => {
    it("should return empty array when no swarms", async () => {
      mockListSwarms.mockReturnValue([]);

      const response = await request(app).get("/api/swarms");
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });

    it("should return list of swarms", async () => {
      mockListSwarms.mockReturnValue([
        {
          id: "swarm-1",
          projectPath: "/tmp/project",
          agents: [{ sessionId: "s1", name: "agent-1", branch: "main", status: "working", isCoordinator: false }],
          createdAt: "2026-02-15T00:00:00Z",
        },
      ]);

      const response = await request(app).get("/api/swarms");
      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe("swarm-1");
    });
  });

  // ==========================================================================
  // GET /api/swarms/:id
  // ==========================================================================

  describe("GET /api/swarms/:id", () => {
    it("should return swarm status", async () => {
      mockGetSwarmStatus.mockReturnValue({
        id: "swarm-1",
        projectPath: "/tmp/project",
        agents: [],
        createdAt: "2026-02-15T00:00:00Z",
      });

      const response = await request(app).get("/api/swarms/swarm-1");
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe("swarm-1");
    });

    it("should return 404 for unknown swarm", async () => {
      mockGetSwarmStatus.mockReturnValue(undefined);

      const response = await request(app).get("/api/swarms/unknown");
      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  // ==========================================================================
  // POST /api/swarms
  // ==========================================================================

  describe("POST /api/swarms", () => {
    it("should create a new swarm", async () => {
      mockCreateSwarm.mockResolvedValue({
        success: true,
        swarm: {
          id: "swarm-1",
          projectPath: "/tmp/project",
          agents: [{ sessionId: "s1", name: "agent-1", branch: "main", status: "working", isCoordinator: false }],
          createdAt: "2026-02-15T00:00:00Z",
        },
      });

      const response = await request(app)
        .post("/api/swarms")
        .send({ projectPath: "/tmp/project", agentCount: 2 });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe("swarm-1");
    });

    it("should return 400 when projectPath is missing", async () => {
      const response = await request(app)
        .post("/api/swarms")
        .send({ agentCount: 2 });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should return 400 when agentCount is missing", async () => {
      const response = await request(app)
        .post("/api/swarms")
        .send({ projectPath: "/tmp" });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should return 400 when creation fails", async () => {
      mockCreateSwarm.mockResolvedValue({
        success: false,
        error: "Agent count must be between 1 and 20",
      });

      const response = await request(app)
        .post("/api/swarms")
        .send({ projectPath: "/tmp", agentCount: 2 });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should accept optional coordinatorIndex and baseName", async () => {
      mockCreateSwarm.mockResolvedValue({
        success: true,
        swarm: { id: "swarm-1", agents: [] },
      });

      const response = await request(app)
        .post("/api/swarms")
        .send({
          projectPath: "/tmp",
          agentCount: 3,
          coordinatorIndex: 0,
          baseName: "worker",
          workspaceType: "worktree",
        });

      expect(response.status).toBe(201);
      expect(mockCreateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          coordinatorIndex: 0,
          baseName: "worker",
          workspaceType: "worktree",
        })
      );
    });
  });

  // ==========================================================================
  // POST /api/swarms/:id/agents
  // ==========================================================================

  describe("POST /api/swarms/:id/agents", () => {
    it("should add an agent to the swarm", async () => {
      mockAddAgentToSwarm.mockResolvedValue({
        success: true,
        agent: { sessionId: "s2", name: "extra", branch: "swarm/swarm-1/extra", status: "working", isCoordinator: false },
      });

      const response = await request(app)
        .post("/api/swarms/swarm-1/agents")
        .send({ name: "extra" });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe("extra");
    });

    it("should add agent without name", async () => {
      mockAddAgentToSwarm.mockResolvedValue({
        success: true,
        agent: { sessionId: "s2", name: "agent-2" },
      });

      const response = await request(app)
        .post("/api/swarms/swarm-1/agents")
        .send({});

      expect(response.status).toBe(201);
      expect(mockAddAgentToSwarm).toHaveBeenCalledWith("swarm-1", undefined);
    });

    it("should return 400 when add fails", async () => {
      mockAddAgentToSwarm.mockResolvedValue({
        success: false,
        error: "Swarm not found",
      });

      const response = await request(app)
        .post("/api/swarms/nonexistent/agents")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  // ==========================================================================
  // GET /api/swarms/:id/branches
  // ==========================================================================

  describe("GET /api/swarms/:id/branches", () => {
    it("should return branch status", async () => {
      mockGetSwarmBranches.mockResolvedValue([
        { branch: "swarm/s1/agent-2", agentName: "agent-2", aheadOfMain: 3, behindMain: 0, hasConflicts: false },
      ]);

      const response = await request(app).get("/api/swarms/swarm-1/branches");
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].aheadOfMain).toBe(3);
    });

    it("should return 404 for unknown swarm", async () => {
      mockGetSwarmBranches.mockResolvedValue(undefined);

      const response = await request(app).get("/api/swarms/unknown/branches");
      expect(response.status).toBe(404);
    });
  });

  // ==========================================================================
  // POST /api/swarms/:id/merge
  // ==========================================================================

  describe("POST /api/swarms/:id/merge", () => {
    it("should merge a branch", async () => {
      mockMergeAgentBranch.mockResolvedValue({
        success: true,
        branch: "swarm/s1/agent-2",
        merged: true,
      });

      const response = await request(app)
        .post("/api/swarms/swarm-1/merge")
        .send({ branch: "swarm/s1/agent-2" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.merged).toBe(true);
    });

    it("should return 400 when branch is missing", async () => {
      const response = await request(app)
        .post("/api/swarms/swarm-1/merge")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should return 400 when merge fails", async () => {
      mockMergeAgentBranch.mockResolvedValue({
        success: false,
        branch: "swarm/s1/agent-2",
        error: "Merge conflicts detected",
        conflicts: ["src/index.ts"],
      });

      const response = await request(app)
        .post("/api/swarms/swarm-1/merge")
        .send({ branch: "swarm/s1/agent-2" });

      expect(response.status).toBe(400);
    });
  });

  // ==========================================================================
  // DELETE /api/swarms/:id/agents/:sessionId
  // ==========================================================================

  describe("DELETE /api/swarms/:id/agents/:sessionId", () => {
    it("should remove agent from swarm", async () => {
      mockRemoveAgentFromSwarm.mockResolvedValue(true);

      const response = await request(app).delete("/api/swarms/swarm-1/agents/sess-1");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.removed).toBe(true);
    });

    it("should pass removeWorktree query param", async () => {
      mockRemoveAgentFromSwarm.mockResolvedValue(true);

      await request(app).delete("/api/swarms/swarm-1/agents/sess-1?removeWorktree=true");

      expect(mockRemoveAgentFromSwarm).toHaveBeenCalledWith("swarm-1", "sess-1", true);
    });

    it("should return 404 when agent not found", async () => {
      mockRemoveAgentFromSwarm.mockResolvedValue(false);

      const response = await request(app).delete("/api/swarms/swarm-1/agents/unknown");

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  // ==========================================================================
  // DELETE /api/swarms/:id
  // ==========================================================================

  describe("DELETE /api/swarms/:id", () => {
    it("should destroy a swarm", async () => {
      mockDestroySwarm.mockResolvedValue(true);

      const response = await request(app).delete("/api/swarms/swarm-1");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.destroyed).toBe(true);
    });

    it("should pass removeWorktrees=false query param", async () => {
      mockDestroySwarm.mockResolvedValue(true);

      await request(app).delete("/api/swarms/swarm-1?removeWorktrees=false");

      expect(mockDestroySwarm).toHaveBeenCalledWith("swarm-1", false);
    });

    it("should default removeWorktrees to true", async () => {
      mockDestroySwarm.mockResolvedValue(true);

      await request(app).delete("/api/swarms/swarm-1");

      expect(mockDestroySwarm).toHaveBeenCalledWith("swarm-1", true);
    });

    it("should return 404 when swarm not found", async () => {
      mockDestroySwarm.mockResolvedValue(false);

      const response = await request(app).delete("/api/swarms/unknown");

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  // ==========================================================================
  // GET /api/swarms/active
  // ==========================================================================

  describe("GET /api/swarms/active", () => {
    it("should return empty array when no swarms exist", async () => {
      mockListSwarms.mockReturnValue([]);

      const response = await request(app).get("/api/swarms/active");
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });

    it("should return summary stats for active swarms", async () => {
      mockListSwarms.mockReturnValue([
        {
          id: "swarm-1",
          projectPath: "/tmp/project",
          agents: [
            { sessionId: "s1", name: "agent-1", status: "working", isCoordinator: true },
            { sessionId: "s2", name: "agent-2", status: "idle", isCoordinator: false },
            { sessionId: "s3", name: "agent-3", status: "working", isCoordinator: false },
          ],
          createdAt: "2026-02-15T00:00:00Z",
        },
      ]);

      const response = await request(app).get("/api/swarms/active");
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);

      const swarm = response.body.data[0];
      expect(swarm.id).toBe("swarm-1");
      expect(swarm.agentCount).toBe(3);
      expect(swarm.activeCount).toBe(2);
      expect(swarm.idleCount).toBe(1);
      expect(swarm.createdAt).toBe("2026-02-15T00:00:00Z");
    });

    it("should count blocked and offline agents correctly", async () => {
      mockListSwarms.mockReturnValue([
        {
          id: "swarm-2",
          projectPath: "/tmp/project2",
          agents: [
            { sessionId: "s1", name: "a1", status: "working", isCoordinator: false },
            { sessionId: "s2", name: "a2", status: "offline", isCoordinator: false },
            { sessionId: "s3", name: "a3", status: "idle", isCoordinator: false },
            { sessionId: "s4", name: "a4", status: "offline", isCoordinator: false },
          ],
          createdAt: "2026-02-16T00:00:00Z",
        },
      ]);

      const response = await request(app).get("/api/swarms/active");
      const swarm = response.body.data[0];
      expect(swarm.agentCount).toBe(4);
      expect(swarm.activeCount).toBe(1);
      expect(swarm.idleCount).toBe(1);
      expect(swarm.offlineCount).toBe(2);
    });

    it("should return multiple swarm summaries", async () => {
      mockListSwarms.mockReturnValue([
        {
          id: "swarm-1",
          projectPath: "/tmp/p1",
          agents: [{ sessionId: "s1", name: "a1", status: "working", isCoordinator: false }],
          createdAt: "2026-02-15T00:00:00Z",
        },
        {
          id: "swarm-2",
          projectPath: "/tmp/p2",
          agents: [{ sessionId: "s2", name: "a2", status: "idle", isCoordinator: false }],
          createdAt: "2026-02-16T00:00:00Z",
        },
      ]);

      const response = await request(app).get("/api/swarms/active");
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].id).toBe("swarm-1");
      expect(response.body.data[1].id).toBe("swarm-2");
    });
  });
});
