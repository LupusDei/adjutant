import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock the status provider before importing the router
const mockGetStatus = vi.fn();
vi.mock("../../src/services/status/index.js", () => ({
  getStatusProvider: () => ({
    getStatus: mockGetStatus,
  }),
}));

import { statusRouter } from "../../src/routes/status.js";

/**
 * Creates a test Express app with the status router mounted.
 */
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/status", statusRouter);
  return app;
}

/**
 * Creates a mock system status for testing.
 */
function createMockStatus(overrides: Record<string, unknown> = {}) {
  return {
    powerState: "running",
    workspace: {
      name: "gastown_boy",
      root: "/Users/test/gt/gastown_boy",
    },
    operator: {
      name: "Test User",
      email: "test@example.com",
      unreadMail: 0,
    },
    rigs: [],
    agents: [],
    fetchedAt: "2026-01-12T12:00:00Z",
    ...overrides,
  };
}

describe("status routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
  });

  describe("GET /api/status", () => {
    it("should return status when running", async () => {
      const mockStatus = createMockStatus({ powerState: "running" });

      mockGetStatus.mockResolvedValue({
        success: true,
        data: mockStatus,
      });

      const response = await request(app).get("/api/status");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.powerState).toBe("running");
      expect(response.body.data.workspace.name).toBe("gastown_boy");
      expect(response.body.timestamp).toBeDefined();
    });

    it("should return status when stopped", async () => {
      const mockStatus = createMockStatus({ powerState: "stopped" });

      mockGetStatus.mockResolvedValue({
        success: true,
        data: mockStatus,
      });

      const response = await request(app).get("/api/status");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.powerState).toBe("stopped");
    });

    it("should return status with rig information", async () => {
      const mockStatus = createMockStatus({
        rigs: [
          {
            name: "gastown_boy",
            path: "/Users/test/gt/gastown_boy/refinery/rig",
            witness: { name: "witness", running: true, unreadMail: 0 },
            refinery: { name: "refinery", running: true, unreadMail: 2 },
            crew: [],
            polecats: [
              { name: "furiosa", running: true, unreadMail: 0, state: "working" },
            ],
            mergeQueue: { pending: 3, inFlight: 1, blocked: 0 },
          },
        ],
      });

      mockGetStatus.mockResolvedValue({
        success: true,
        data: mockStatus,
      });

      const response = await request(app).get("/api/status");

      expect(response.status).toBe(200);
      expect(response.body.data.rigs).toHaveLength(1);
      expect(response.body.data.rigs[0].name).toBe("gastown_boy");
      expect(response.body.data.rigs[0].polecats).toHaveLength(1);
      expect(response.body.data.rigs[0].mergeQueue.pending).toBe(3);
    });

    it("should return 500 on service error", async () => {
      mockGetStatus.mockResolvedValue({
        success: false,
        error: { code: "CLI_ERROR", message: "status command failed" },
      });

      const response = await request(app).get("/api/status");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("INTERNAL_ERROR");
      expect(response.body.error.message).toBe("status command failed");
    });

    it("should return 500 with default message on unknown error", async () => {
      mockGetStatus.mockResolvedValue({
        success: false,
        error: undefined,
      });

      const response = await request(app).get("/api/status");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe("Failed to get system status");
    });

    it("should include operator information", async () => {
      const mockStatus = createMockStatus({
        operator: {
          name: "Will Saults",
          email: "will@saults.io",
          unreadMail: 10,
        },
      });

      mockGetStatus.mockResolvedValue({
        success: true,
        data: mockStatus,
      });

      const response = await request(app).get("/api/status");

      expect(response.status).toBe(200);
      expect(response.body.data.operator.name).toBe("Will Saults");
      expect(response.body.data.operator.email).toBe("will@saults.io");
      expect(response.body.data.operator.unreadMail).toBe(10);
    });
  });
});
