import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const mockGetConfig = vi.fn();
const mockUpdateConfig = vi.fn();
const mockGetEffectiveMode = vi.fn();

vi.mock("../../src/services/permission-service.js", () => ({
  getPermissionConfig: (...args: unknown[]) => mockGetConfig(...args),
  updatePermissionConfig: (...args: unknown[]) => mockUpdateConfig(...args),
  getEffectiveMode: (...args: unknown[]) => mockGetEffectiveMode(...args),
}));

import { permissionsRouter } from "../../src/routes/permissions.js";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/permissions", permissionsRouter);
  return app;
}

describe("permissions routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();
  });

  describe("GET /api/permissions", () => {
    it("should return permission config", async () => {
      mockGetConfig.mockReturnValue({
        defaultMode: "manual",
        sessions: {},
        toolOverrides: {},
      });

      const response = await request(app).get("/api/permissions");
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.defaultMode).toBe("manual");
    });
  });

  describe("PATCH /api/permissions", () => {
    it("should update permission config", async () => {
      mockUpdateConfig.mockReturnValue({
        defaultMode: "auto_accept",
        sessions: {},
        toolOverrides: {},
      });

      const response = await request(app)
        .patch("/api/permissions")
        .send({ defaultMode: "auto_accept" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.defaultMode).toBe("auto_accept");
    });

    it("should reject invalid mode", async () => {
      const response = await request(app)
        .patch("/api/permissions")
        .send({ defaultMode: "invalid_mode" });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe("GET /api/permissions/:sessionId", () => {
    it("should return effective mode for session", async () => {
      mockGetEffectiveMode.mockReturnValue("auto_accept");

      const response = await request(app).get("/api/permissions/sess-1");
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.mode).toBe("auto_accept");
      expect(response.body.data.sessionId).toBe("sess-1");
    });
  });
});
