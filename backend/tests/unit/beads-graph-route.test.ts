import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock the beads-service before importing the router
vi.mock("../../src/services/beads-service.js", () => ({
  listBeads: vi.fn(),
  listAllBeads: vi.fn(),
  getBead: vi.fn(),
  listBeadSources: vi.fn(),
  listRecentlyClosed: vi.fn(),
  getBeadsGraph: vi.fn(),
}));

vi.mock("../../src/services/workspace/index.js", () => ({
  resolveWorkspaceRoot: vi.fn(() => "/tmp/town"),
  resolveRigPath: vi.fn((rig: string) => `/tmp/town/${rig}`),
}));

import { beadsRouter } from "../../src/routes/beads.js";
import { getBeadsGraph, getBead } from "../../src/services/beads-service.js";
import type { BeadsGraphResponse } from "../../src/types/beads.js";

/**
 * Creates a test Express app with the beads router mounted.
 */
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/beads", beadsRouter);
  return app;
}

describe("GET /api/beads/graph", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
  });

  it("should return 200 with valid graph data", async () => {
    const mockGraphData: BeadsGraphResponse = {
      nodes: [
        { id: "hq-001", title: "Epic", status: "open", type: "epic", priority: 1, assignee: null, source: "town" },
        { id: "hq-002", title: "Task", status: "in_progress", type: "task", priority: 2, assignee: "mayor/crew/alice", source: "town" },
      ],
      edges: [
        { issueId: "hq-001", dependsOnId: "hq-002", type: "parent" },
      ],
    };

    vi.mocked(getBeadsGraph).mockResolvedValue({
      success: true,
      data: mockGraphData,
    });

    const response = await request(app).get("/api/beads/graph");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.nodes).toHaveLength(2);
    expect(response.body.data.edges).toHaveLength(1);
    expect(response.body.data.nodes[0].id).toBe("hq-001");
    expect(response.body.data.edges[0].issueId).toBe("hq-001");
    expect(response.body.data.edges[0].dependsOnId).toBe("hq-002");
  });

  it("should return 200 with empty graph when no beads exist", async () => {
    vi.mocked(getBeadsGraph).mockResolvedValue({
      success: true,
      data: { nodes: [], edges: [] },
    });

    const response = await request(app).get("/api/beads/graph");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.nodes).toEqual([]);
    expect(response.body.data.edges).toEqual([]);
  });

  it("should return 500 on service error", async () => {
    vi.mocked(getBeadsGraph).mockResolvedValue({
      success: false,
      error: { code: "BD_PANIC", message: "bd crashed: nil pointer dereference" },
    });

    const response = await request(app).get("/api/beads/graph");

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.error.message).toContain("bd crashed");
  });

  it("should return 500 with default message when error is undefined", async () => {
    vi.mocked(getBeadsGraph).mockResolvedValue({
      success: false,
      error: undefined,
    });

    const response = await request(app).get("/api/beads/graph");

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.error.message).toBe("Failed to build beads graph");
  });

  it("should not conflict with GET /api/beads/:id route", async () => {
    // Ensure "graph" is handled as the /graph route, not as a bead ID
    vi.mocked(getBeadsGraph).mockResolvedValue({
      success: true,
      data: { nodes: [], edges: [] },
    });

    const response = await request(app).get("/api/beads/graph");

    expect(response.status).toBe(200);
    expect(getBeadsGraph).toHaveBeenCalled();
    expect(getBead).not.toHaveBeenCalled();
  });

  it("should call getBeadsGraph service function", async () => {
    vi.mocked(getBeadsGraph).mockResolvedValue({
      success: true,
      data: { nodes: [], edges: [] },
    });

    await request(app).get("/api/beads/graph");

    expect(getBeadsGraph).toHaveBeenCalledTimes(1);
  });
});
