import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Create mock provider
const mockProvider = {
  name: "mock",
  getStatus: vi.fn(),
  getPowerCapabilities: vi.fn(),
  hasPowerControl: vi.fn(() => true),
  powerUp: vi.fn(),
  powerDown: vi.fn(),
};

// Mock the status provider before importing the router
vi.mock("../../src/services/status/index.js", () => ({
  getStatusProvider: vi.fn(() => mockProvider),
}));

import { powerRouter } from "../../src/routes/power.js";

/**
 * Creates a test Express app with the power router mounted.
 */
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/power", powerRouter);
  return app;
}

describe("power routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
    mockProvider.hasPowerControl.mockReturnValue(true);
  });

  // ===========================================================================
  // GET /api/power/status
  // ===========================================================================

  describe("GET /api/power/status", () => {
    it("should return current gastown status", async () => {
      mockProvider.getStatus.mockResolvedValue({
        success: true,
        data: {
          powerState: "running",
          uptime: 3600,
        },
      });

      const response = await request(app).get("/api/power/status");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.powerState).toBe("running");
      expect(response.body.data.uptime).toBe(3600);
    });

    it("should return stopped status", async () => {
      mockProvider.getStatus.mockResolvedValue({
        success: true,
        data: {
          powerState: "stopped",
        },
      });

      const response = await request(app).get("/api/power/status");

      expect(response.status).toBe(200);
      expect(response.body.data.powerState).toBe("stopped");
    });

    it("should return 500 on service error", async () => {
      mockProvider.getStatus.mockResolvedValue({
        success: false,
        error: { code: "STATUS_ERROR", message: "Could not read status" },
      });

      const response = await request(app).get("/api/power/status");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe("Could not read status");
    });

    it("should return 500 with default message on unknown error", async () => {
      mockProvider.getStatus.mockResolvedValue({
        success: false,
        error: undefined,
      });

      const response = await request(app).get("/api/power/status");

      expect(response.status).toBe(500);
      expect(response.body.error.message).toBe("Failed to get status");
    });
  });

  // ===========================================================================
  // POST /api/power/up
  // ===========================================================================

  describe("POST /api/power/up", () => {
    it("should start gastown successfully", async () => {
      mockProvider.powerUp.mockResolvedValue({
        success: true,
        data: {
          previousState: "stopped",
          newState: "starting",
        },
      });

      const response = await request(app).post("/api/power/up");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.previousState).toBe("stopped");
      expect(response.body.data.newState).toBe("starting");
    });

    it("should return 409 when already running", async () => {
      mockProvider.powerUp.mockResolvedValue({
        success: false,
        error: { code: "ALREADY_RUNNING", message: "Gastown is already running" },
      });

      const response = await request(app).post("/api/power/up");

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("CONFLICT");
      expect(response.body.error.message).toBe("Gastown is already running");
    });

    it("should return 500 on other errors", async () => {
      mockProvider.powerUp.mockResolvedValue({
        success: false,
        error: { code: "START_ERROR", message: "Failed to spawn tmux session" },
      });

      const response = await request(app).post("/api/power/up");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe("Failed to spawn tmux session");
    });

    it("should return 500 with default message on unknown error", async () => {
      mockProvider.powerUp.mockResolvedValue({
        success: false,
        error: undefined,
      });

      const response = await request(app).post("/api/power/up");

      expect(response.status).toBe(500);
      expect(response.body.error.message).toBe("Failed to start system");
    });

    it("should return 400 when power control not available", async () => {
      mockProvider.hasPowerControl.mockReturnValue(false);

      const response = await request(app).post("/api/power/up");

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe("Power control is not available in this deployment mode");
    });
  });

  // ===========================================================================
  // POST /api/power/down
  // ===========================================================================

  describe("POST /api/power/down", () => {
    it("should stop gastown successfully", async () => {
      mockProvider.powerDown.mockResolvedValue({
        success: true,
        data: {
          previousState: "running",
          newState: "stopping",
        },
      });

      const response = await request(app).post("/api/power/down");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.previousState).toBe("running");
      expect(response.body.data.newState).toBe("stopping");
    });

    it("should return 409 when already stopped", async () => {
      mockProvider.powerDown.mockResolvedValue({
        success: false,
        error: { code: "ALREADY_STOPPED", message: "Gastown is already stopped" },
      });

      const response = await request(app).post("/api/power/down");

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("CONFLICT");
      expect(response.body.error.message).toBe("Gastown is already stopped");
    });

    it("should return 500 on other errors", async () => {
      mockProvider.powerDown.mockResolvedValue({
        success: false,
        error: { code: "STOP_ERROR", message: "Failed to kill tmux session" },
      });

      const response = await request(app).post("/api/power/down");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe("Failed to kill tmux session");
    });

    it("should return 500 with default message on unknown error", async () => {
      mockProvider.powerDown.mockResolvedValue({
        success: false,
        error: undefined,
      });

      const response = await request(app).post("/api/power/down");

      expect(response.status).toBe(500);
      expect(response.body.error.message).toBe("Failed to stop system");
    });

    it("should return 400 when power control not available", async () => {
      mockProvider.hasPowerControl.mockReturnValue(false);

      const response = await request(app).post("/api/power/down");

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe("Power control is not available in this deployment mode");
    });
  });
});
