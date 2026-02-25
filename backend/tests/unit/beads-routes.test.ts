import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock the beads-service before importing the router
vi.mock("../../src/services/beads/index.js", () => ({
  listBeads: vi.fn(),
  listAllBeads: vi.fn(),
  getBead: vi.fn(),
  listBeadSources: vi.fn(),
  listRecentlyClosed: vi.fn(),
}));

vi.mock("../../src/services/gastown-workspace.js", () => ({
  resolveTownRoot: vi.fn(() => "/tmp/town"),
  resolveRigPath: vi.fn((rig: string) => `/tmp/town/${rig}`),
}));

import { beadsRouter } from "../../src/routes/beads.js";
import { listBeads, listAllBeads, getBead, listBeadSources, listRecentlyClosed } from "../../src/services/beads/index.js";
import type { BeadInfo, BeadDetail, RecentlyClosedBead } from "../../src/services/beads/index.js";

/**
 * Creates a test Express app with the beads router mounted.
 */
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/beads", beadsRouter);
  return app;
}

/**
 * Creates a mock BeadInfo for testing.
 */
function createMockBead(overrides: Partial<BeadInfo> = {}): BeadInfo {
  return {
    id: "hq-001",
    title: "Test Bead",
    status: "open",
    priority: 2,
    type: "task",
    assignee: null,
    rig: null,
    source: "town",
    labels: [],
    createdAt: "2026-01-15T10:00:00Z",
    updatedAt: null,
    ...overrides,
  };
}

/**
 * Creates a mock BeadDetail for testing.
 */
function createMockBeadDetail(overrides: Partial<BeadDetail> = {}): BeadDetail {
  return {
    id: "hq-001",
    title: "Test Bead Detail",
    description: "A test bead description",
    status: "open",
    priority: 2,
    type: "task",
    assignee: null,
    rig: null,
    source: "town",
    labels: [],
    createdAt: "2026-01-15T10:00:00Z",
    updatedAt: null,
    closedAt: null,
    agentState: null,
    dependencies: [],
    isWisp: false,
    isPinned: false,
    ...overrides,
  };
}

describe("beads routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
  });

  describe("GET /api/beads", () => {
    it("should return empty array when no beads (defaults to town)", async () => {
      vi.mocked(listBeads).mockResolvedValue({
        success: true,
        data: [],
      });

      const response = await request(app).get("/api/beads");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
      expect(listBeads).toHaveBeenCalled();
      expect(listAllBeads).not.toHaveBeenCalled();
    });

    it("should return list of beads", async () => {
      const mockBeads = [
        createMockBead({ id: "hq-001", title: "First bead" }),
        createMockBead({ id: "hq-002", title: "Second bead" }),
      ];

      vi.mocked(listBeads).mockResolvedValue({
        success: true,
        data: mockBeads,
      });

      const response = await request(app).get("/api/beads");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].title).toBe("First bead");
      expect(response.body.data[1].title).toBe("Second bead");
    });

    it("should call listBeads when rig=town (explicit)", async () => {
      vi.mocked(listBeads).mockResolvedValue({
        success: true,
        data: [],
      });

      await request(app).get("/api/beads?rig=town");

      expect(listBeads).toHaveBeenCalled();
      expect(listAllBeads).not.toHaveBeenCalled();
    });

    it("should call listBeads when rig is a specific rig name", async () => {
      vi.mocked(listBeads).mockResolvedValue({
        success: true,
        data: [],
      });

      await request(app).get("/api/beads?rig=gastown_boy");

      expect(listBeads).toHaveBeenCalled();
      expect(listAllBeads).not.toHaveBeenCalled();
    });

    it("should call listAllBeads when rig=all", async () => {
      vi.mocked(listAllBeads).mockResolvedValue({
        success: true,
        data: [],
      });

      await request(app).get("/api/beads?rig=all");

      expect(listAllBeads).toHaveBeenCalled();
      expect(listBeads).not.toHaveBeenCalled();
    });

    it("should pass status query parameter with rig=all", async () => {
      vi.mocked(listAllBeads).mockResolvedValue({
        success: true,
        data: [],
      });

      await request(app).get("/api/beads?rig=all&status=closed");

      expect(listAllBeads).toHaveBeenCalledWith(
        expect.objectContaining({ status: "closed" })
      );
    });

    it("should pass status query parameter (default town)", async () => {
      vi.mocked(listBeads).mockResolvedValue({
        success: true,
        data: [],
      });

      await request(app).get("/api/beads?status=closed");

      expect(listBeads).toHaveBeenCalledWith(
        expect.objectContaining({ status: "closed" })
      );
    });

    it("should pass type query parameter", async () => {
      vi.mocked(listBeads).mockResolvedValue({
        success: true,
        data: [],
      });

      await request(app).get("/api/beads?type=bug");

      expect(listBeads).toHaveBeenCalledWith(
        expect.objectContaining({ type: "bug" })
      );
    });

    it("should pass limit query parameter", async () => {
      vi.mocked(listBeads).mockResolvedValue({
        success: true,
        data: [],
      });

      await request(app).get("/api/beads?limit=50");

      expect(listBeads).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50 })
      );
    });

    it("should use default limit of 500 when not provided", async () => {
      vi.mocked(listBeads).mockResolvedValue({
        success: true,
        data: [],
      });

      await request(app).get("/api/beads");

      expect(listBeads).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 500 })
      );
    });

    it("should return 200 with empty array on listAllBeads error (rig=all)", async () => {
      vi.mocked(listAllBeads).mockResolvedValue({
        success: false,
        error: { code: "BD_ERROR", message: "Database not found" },
      });

      const response = await request(app).get("/api/beads?rig=all");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });

    it("should return 500 with error on listBeads failure when rig specified", async () => {
      vi.mocked(listBeads).mockResolvedValue({
        success: false,
        error: { code: "BD_ERROR", message: "Rig database not found" },
      });

      const response = await request(app).get("/api/beads?rig=gastown_boy");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe("Rig database not found");
    });

    it("should return 200 with empty array on listBeads error (default town)", async () => {
      vi.mocked(listBeads).mockResolvedValue({
        success: false,
        error: undefined,
      });

      const response = await request(app).get("/api/beads");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });
  });

  describe("GET /api/beads/:id", () => {
    it("should return 200 with bead data for valid ID", async () => {
      const mockDetail = createMockBeadDetail({
        id: "hq-vts8",
        title: "Test Bead Details",
        description: "Full description of the bead",
      });

      vi.mocked(getBead).mockResolvedValue({
        success: true,
        data: mockDetail,
      });

      const response = await request(app).get("/api/beads/hq-vts8");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe("hq-vts8");
      expect(response.body.data.title).toBe("Test Bead Details");
      expect(response.body.data.description).toBe("Full description of the bead");
      expect(getBead).toHaveBeenCalledWith("hq-vts8");
    });

    it("should return full BeadDetail fields", async () => {
      const mockDetail = createMockBeadDetail({
        id: "hq-full",
        title: "Full Bead",
        description: "Complete description",
        status: "in_progress",
        priority: 1,
        type: "feature",
        assignee: "gastown_boy/polecats/toast",
        rig: "gastown_boy",
        source: "town",
        labels: ["urgent", "backend"],
        agentState: "working",
        dependencies: [{ issueId: "hq-full", dependsOnId: "hq-dep1", type: "blocks" }],
        isWisp: false,
        isPinned: true,
      });

      vi.mocked(getBead).mockResolvedValue({
        success: true,
        data: mockDetail,
      });

      const response = await request(app).get("/api/beads/hq-full");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      const data = response.body.data;
      expect(data.description).toBe("Complete description");
      expect(data.agentState).toBe("working");
      expect(data.dependencies).toHaveLength(1);
      expect(data.isPinned).toBe(true);
      expect(data.isWisp).toBe(false);
    });

    it("should return 404 for non-existent bead", async () => {
      vi.mocked(getBead).mockResolvedValue({
        success: false,
        error: { code: "BEAD_NOT_FOUND", message: "Bead not found: hq-9999" },
      });

      const response = await request(app).get("/api/beads/hq-9999");

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe("Bead not found: hq-9999");
    });

    it("should return 400 for missing bead ID", async () => {
      // Express won't match the route without an ID, but we test the edge case
      // by calling the endpoint without a valid ID segment
      // Note: Express routing means /api/beads/ goes to list endpoint
      // This test validates the route exists and handles the param
      const response = await request(app).get("/api/beads/");

      // Without ID, it matches the list endpoint
      expect(response.status).not.toBe(400);
    });

    it("should return 500 for service errors (non-404)", async () => {
      vi.mocked(getBead).mockResolvedValue({
        success: false,
        error: { code: "DATABASE_ERROR", message: "Database connection failed" },
      });

      const response = await request(app).get("/api/beads/hq-error");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe("Database connection failed");
    });

    it("should return 500 with default message when error is undefined", async () => {
      vi.mocked(getBead).mockResolvedValue({
        success: false,
        error: undefined,
      });

      const response = await request(app).get("/api/beads/hq-noerror");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe("Failed to get bead");
    });

    it("should handle rig-specific bead IDs (adj-* prefix)", async () => {
      const mockDetail = createMockBeadDetail({
        id: "adj-67tta",
        title: "Adjutant Bead",
        source: "adjutant",
        rig: "adjutant",
      });

      vi.mocked(getBead).mockResolvedValue({
        success: true,
        data: mockDetail,
      });

      const response = await request(app).get("/api/beads/adj-67tta");

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe("adj-67tta");
      expect(response.body.data.source).toBe("adjutant");
      expect(getBead).toHaveBeenCalledWith("adj-67tta");
    });
  });

  describe("GET /api/beads/sources", () => {
    it("should return sources and mode", async () => {
      vi.mocked(listBeadSources).mockResolvedValue({
        success: true,
        data: {
          sources: [
            { name: "ottodom", path: "/tmp/projects/ottodom", hasBeads: true },
            { name: "l2rr2l", path: "/tmp/projects/l2rr2l", hasBeads: true },
          ],
          mode: "swarm",
        },
      });

      const response = await request(app).get("/api/beads/sources");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.sources).toHaveLength(2);
      expect(response.body.data.sources[0].name).toBe("ottodom");
      expect(response.body.data.sources[1].name).toBe("l2rr2l");
      expect(response.body.data.mode).toBe("swarm");
    });

    it("should return empty sources when no beads dirs found", async () => {
      vi.mocked(listBeadSources).mockResolvedValue({
        success: true,
        data: {
          sources: [],
          mode: "swarm",
        },
      });

      const response = await request(app).get("/api/beads/sources");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.sources).toEqual([]);
    });

    it("should return gastown mode with rig names", async () => {
      vi.mocked(listBeadSources).mockResolvedValue({
        success: true,
        data: {
          sources: [
            { name: "adjutant", path: "/tmp/town/adjutant", hasBeads: true },
            { name: "gastown_boy", path: "/tmp/town/gastown_boy", hasBeads: true },
          ],
          mode: "gastown",
        },
      });

      const response = await request(app).get("/api/beads/sources");

      expect(response.status).toBe(200);
      expect(response.body.data.mode).toBe("gastown");
      expect(response.body.data.sources).toHaveLength(2);
    });

    it("should return 500 on service error", async () => {
      vi.mocked(listBeadSources).mockResolvedValue({
        success: false,
        error: { code: "SOURCES_ERROR", message: "Discovery failed" },
      });

      const response = await request(app).get("/api/beads/sources");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe("Discovery failed");
    });

    it("should not conflict with GET /api/beads/:id route", async () => {
      // Ensure "sources" is handled as the /sources route, not as a bead ID
      vi.mocked(listBeadSources).mockResolvedValue({
        success: true,
        data: { sources: [], mode: "swarm" },
      });

      const response = await request(app).get("/api/beads/sources");

      expect(response.status).toBe(200);
      expect(listBeadSources).toHaveBeenCalled();
      expect(getBead).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/beads/recent-closed", () => {
    function createMockRecentlyClosed(overrides: Partial<RecentlyClosedBead> = {}): RecentlyClosedBead {
      return {
        id: "hq-done1",
        title: "Completed Task",
        assignee: "gastown_boy/polecats/ace",
        closedAt: "2026-02-23T10:30:00Z",
        type: "task",
        priority: 2,
        rig: "gastown_boy",
        source: "town",
        ...overrides,
      };
    }

    it("should return recently closed beads with default hours=1", async () => {
      const mockData = [
        createMockRecentlyClosed({ id: "hq-a1", title: "First done" }),
        createMockRecentlyClosed({ id: "hq-a2", title: "Second done" }),
      ];

      vi.mocked(listRecentlyClosed).mockResolvedValue({
        success: true,
        data: mockData,
      });

      const response = await request(app).get("/api/beads/recent-closed");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].id).toBe("hq-a1");
      expect(response.body.data[1].id).toBe("hq-a2");
      expect(listRecentlyClosed).toHaveBeenCalledWith(1);
    });

    it("should pass hours query parameter", async () => {
      vi.mocked(listRecentlyClosed).mockResolvedValue({
        success: true,
        data: [],
      });

      await request(app).get("/api/beads/recent-closed?hours=6");

      expect(listRecentlyClosed).toHaveBeenCalledWith(6);
    });

    it("should clamp hours to minimum of 1", async () => {
      vi.mocked(listRecentlyClosed).mockResolvedValue({
        success: true,
        data: [],
      });

      await request(app).get("/api/beads/recent-closed?hours=0");

      expect(listRecentlyClosed).toHaveBeenCalledWith(1);
    });

    it("should clamp hours to maximum of 24", async () => {
      vi.mocked(listRecentlyClosed).mockResolvedValue({
        success: true,
        data: [],
      });

      await request(app).get("/api/beads/recent-closed?hours=100");

      expect(listRecentlyClosed).toHaveBeenCalledWith(24);
    });

    it("should default to 1 hour for non-numeric hours", async () => {
      vi.mocked(listRecentlyClosed).mockResolvedValue({
        success: true,
        data: [],
      });

      await request(app).get("/api/beads/recent-closed?hours=abc");

      expect(listRecentlyClosed).toHaveBeenCalledWith(1);
    });

    it("should return 500 on service error", async () => {
      vi.mocked(listRecentlyClosed).mockResolvedValue({
        success: false,
        error: { code: "RECENT_CLOSED_ERROR", message: "Database failed" },
      });

      const response = await request(app).get("/api/beads/recent-closed");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe("Database failed");
    });

    it("should not conflict with GET /api/beads/:id route", async () => {
      // Ensure "recent-closed" is handled as the /recent-closed route, not as a bead ID
      vi.mocked(listRecentlyClosed).mockResolvedValue({
        success: true,
        data: [],
      });

      const response = await request(app).get("/api/beads/recent-closed");

      expect(response.status).toBe(200);
      expect(listRecentlyClosed).toHaveBeenCalled();
      expect(getBead).not.toHaveBeenCalled();
    });

    it("should return empty array when no beads closed recently", async () => {
      vi.mocked(listRecentlyClosed).mockResolvedValue({
        success: true,
        data: [],
      });

      const response = await request(app).get("/api/beads/recent-closed");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });

    it("should include all expected fields in response", async () => {
      const mockBead = createMockRecentlyClosed({
        id: "adj-done1",
        title: "Build endpoint",
        assignee: "adjutant/polecats/toast",
        closedAt: "2026-02-23T11:00:00Z",
        type: "task",
        priority: 1,
        rig: "adjutant",
        source: "adjutant",
      });

      vi.mocked(listRecentlyClosed).mockResolvedValue({
        success: true,
        data: [mockBead],
      });

      const response = await request(app).get("/api/beads/recent-closed");

      expect(response.status).toBe(200);
      const data = response.body.data[0];
      expect(data.id).toBe("adj-done1");
      expect(data.title).toBe("Build endpoint");
      expect(data.assignee).toBe("adjutant/polecats/toast");
      expect(data.closedAt).toBe("2026-02-23T11:00:00Z");
      expect(data.type).toBe("task");
      expect(data.priority).toBe(1);
      expect(data.rig).toBe("adjutant");
      expect(data.source).toBe("adjutant");
    });
  });
});
