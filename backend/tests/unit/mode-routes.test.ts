import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock the mode-service before importing the router
vi.mock("../../src/services/mode-service.js", () => ({
  getModeInfo: vi.fn(),
  switchMode: vi.fn(),
}));

import { modeRouter } from "../../src/routes/mode.js";
import { getModeInfo, switchMode } from "../../src/services/mode-service.js";
import type { ModeInfo, ModeServiceResult } from "../../src/services/mode-service.js";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/mode", modeRouter);
  return app;
}

function createMockModeInfo(overrides: Partial<ModeInfo> = {}): ModeInfo {
  return {
    mode: "swarm",
    features: ["chat", "crew_flat", "beads", "epics", "mail", "websocket", "sse"],
    availableModes: [
      { mode: "gastown", available: false, reason: "Gas Town infrastructure not detected" },
      { mode: "swarm", available: true },
    ],
    ...overrides,
  };
}

describe("mode routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // GET /api/mode
  // ===========================================================================

  describe("GET /api/mode", () => {
    it("should return current mode info", async () => {
      const mockInfo = createMockModeInfo();
      vi.mocked(getModeInfo).mockReturnValue(mockInfo);

      const response = await request(app).get("/api/mode");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.mode).toBe("swarm");
      expect(response.body.data.features).toEqual(["chat", "crew_flat", "beads", "epics", "mail", "websocket", "sse"]);
      expect(response.body.data.availableModes).toHaveLength(2);
    });

    it("should return gastown mode info when in gastown mode", async () => {
      const mockInfo = createMockModeInfo({
        mode: "gastown",
        features: ["power_control", "rigs", "epics", "crew_hierarchy", "mail", "dashboard", "refinery", "witness", "websocket", "sse"],
        availableModes: [
          { mode: "gastown", available: true },
          { mode: "swarm", available: true },
        ],
      });
      vi.mocked(getModeInfo).mockReturnValue(mockInfo);

      const response = await request(app).get("/api/mode");

      expect(response.status).toBe(200);
      expect(response.body.data.mode).toBe("gastown");
      expect(response.body.data.features).toContain("power_control");
    });

    it("should return 500 on service error", async () => {
      vi.mocked(getModeInfo).mockImplementation(() => {
        throw new Error("Service failure");
      });

      const response = await request(app).get("/api/mode");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe("Service failure");
    });

    it("should return 500 with default message on unknown error", async () => {
      vi.mocked(getModeInfo).mockImplementation(() => {
        throw "unknown";
      });

      const response = await request(app).get("/api/mode");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe("Failed to get mode info");
    });
  });

  // ===========================================================================
  // POST /api/mode
  // ===========================================================================

  describe("POST /api/mode", () => {
    it("should switch mode successfully", async () => {
      const mockResult: ModeServiceResult<ModeInfo> = {
        success: true,
        data: createMockModeInfo({ mode: "gastown", features: ["power_control", "rigs", "epics", "crew_hierarchy", "mail", "dashboard", "refinery", "witness", "websocket", "sse"] }),
      };
      vi.mocked(switchMode).mockReturnValue(mockResult);

      const response = await request(app)
        .post("/api/mode")
        .send({ mode: "gastown" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.mode).toBe("gastown");
      expect(switchMode).toHaveBeenCalledWith("gastown");
    });

    it("should return 400 when mode is missing", async () => {
      const response = await request(app)
        .post("/api/mode")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain("Missing required field: mode");
    });

    it("should return 400 for invalid mode value", async () => {
      const response = await request(app)
        .post("/api/mode")
        .send({ mode: "invalid" });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain("Invalid mode: invalid");
      expect(response.body.error.message).toContain("gastown");
      expect(response.body.error.message).toContain("swarm");
    });

    it("should return 400 when mode switch fails (e.g., gastown unavailable)", async () => {
      const mockResult: ModeServiceResult<ModeInfo> = {
        success: false,
        error: {
          code: "MODE_UNAVAILABLE",
          message: "Cannot switch to Gas Town mode: infrastructure not detected",
        },
      };
      vi.mocked(switchMode).mockReturnValue(mockResult);

      const response = await request(app)
        .post("/api/mode")
        .send({ mode: "gastown" });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain("Cannot switch to Gas Town mode");
    });

    it("should return 500 on unexpected service error", async () => {
      vi.mocked(switchMode).mockImplementation(() => {
        throw new Error("Unexpected failure");
      });

      const response = await request(app)
        .post("/api/mode")
        .send({ mode: "swarm" });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe("Unexpected failure");
    });

    it("should return 500 with default message on unknown throw", async () => {
      vi.mocked(switchMode).mockImplementation(() => {
        throw 42;
      });

      const response = await request(app)
        .post("/api/mode")
        .send({ mode: "swarm" });

      expect(response.status).toBe(500);
      expect(response.body.error.message).toBe("Failed to switch mode");
    });

    it("should accept all valid mode values", async () => {
      for (const mode of ["gastown", "swarm"]) {
        vi.mocked(switchMode).mockReturnValue({
          success: true,
          data: createMockModeInfo({ mode: mode as ModeInfo["mode"] }),
        });

        const response = await request(app)
          .post("/api/mode")
          .send({ mode });

        expect(response.status).toBe(200);
        expect(switchMode).toHaveBeenCalledWith(mode);
      }
    });
  });
});
