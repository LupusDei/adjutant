import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock the beads-service before importing the router
vi.mock("../../src/services/beads-service.js", () => ({
  listBeads: vi.fn(),
  listAllBeads: vi.fn(),
}));

vi.mock("../../src/services/gastown-workspace.js", () => ({
  resolveTownRoot: vi.fn(() => "/tmp/town"),
  resolveRigPath: vi.fn((rig: string) => `/tmp/town/${rig}`),
}));

import { beadsRouter } from "../../src/routes/beads.js";
import { listBeads, listAllBeads } from "../../src/services/beads-service.js";
import type { BeadInfo } from "../../src/services/beads-service.js";

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

describe("beads routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
  });

  describe("GET /api/beads", () => {
    it("should return empty array when no beads", async () => {
      vi.mocked(listAllBeads).mockResolvedValue({
        success: true,
        data: [],
      });

      const response = await request(app).get("/api/beads");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });

    it("should return list of beads", async () => {
      const mockBeads = [
        createMockBead({ id: "gb-001", title: "First bead" }),
        createMockBead({ id: "gb-002", title: "Second bead" }),
      ];

      vi.mocked(listAllBeads).mockResolvedValue({
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

    it("should call listBeads when rig query parameter is provided", async () => {
      vi.mocked(listBeads).mockResolvedValue({
        success: true,
        data: [],
      });

      await request(app).get("/api/beads?rig=gastown_boy");

      expect(listBeads).toHaveBeenCalled();
      expect(listAllBeads).not.toHaveBeenCalled();
    });

    it("should call listAllBeads when no rig specified", async () => {
      vi.mocked(listAllBeads).mockResolvedValue({
        success: true,
        data: [],
      });

      await request(app).get("/api/beads");

      expect(listAllBeads).toHaveBeenCalled();
      expect(listBeads).not.toHaveBeenCalled();
    });

    it("should pass status query parameter", async () => {
      vi.mocked(listAllBeads).mockResolvedValue({
        success: true,
        data: [],
      });

      await request(app).get("/api/beads?status=closed");

      expect(listAllBeads).toHaveBeenCalledWith(
        expect.objectContaining({ status: "closed" })
      );
    });

    it("should pass type query parameter", async () => {
      vi.mocked(listAllBeads).mockResolvedValue({
        success: true,
        data: [],
      });

      await request(app).get("/api/beads?type=bug");

      expect(listAllBeads).toHaveBeenCalledWith(
        expect.objectContaining({ type: "bug" })
      );
    });

    it("should pass limit query parameter", async () => {
      vi.mocked(listAllBeads).mockResolvedValue({
        success: true,
        data: [],
      });

      await request(app).get("/api/beads?limit=50");

      expect(listAllBeads).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50 })
      );
    });

    it("should use default limit of 500 when not provided", async () => {
      vi.mocked(listAllBeads).mockResolvedValue({
        success: true,
        data: [],
      });

      await request(app).get("/api/beads");

      expect(listAllBeads).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 500 })
      );
    });

    it("should return 500 on listAllBeads error", async () => {
      vi.mocked(listAllBeads).mockResolvedValue({
        success: false,
        error: { code: "BD_ERROR", message: "Database not found" },
      });

      const response = await request(app).get("/api/beads");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe("Database not found");
    });

    it("should return 500 on listBeads error when rig specified", async () => {
      vi.mocked(listBeads).mockResolvedValue({
        success: false,
        error: { code: "BD_ERROR", message: "Rig database not found" },
      });

      const response = await request(app).get("/api/beads?rig=gastown_boy");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe("Rig database not found");
    });

    it("should return 500 with default message on unknown error", async () => {
      vi.mocked(listAllBeads).mockResolvedValue({
        success: false,
        error: undefined,
      });

      const response = await request(app).get("/api/beads");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe("Failed to list beads");
    });
  });
});
