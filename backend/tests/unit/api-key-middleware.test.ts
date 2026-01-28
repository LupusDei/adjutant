import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock the api-key-service
vi.mock("../../src/services/api-key-service.js", () => ({
  hasApiKeys: vi.fn(),
  validateApiKey: vi.fn(),
}));

import { apiKeyAuth } from "../../src/middleware/api-key.js";
import { hasApiKeys, validateApiKey } from "../../src/services/api-key-service.js";

describe("api-key-middleware", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.resetAllMocks();
    app = express();
    app.use(apiKeyAuth);
    app.get("/health", (_req, res) => res.json({ status: "ok" }));
    app.get("/api/test", (_req, res) => res.json({ data: "protected" }));
  });

  describe("public paths", () => {
    it("allows /health without authentication", async () => {
      vi.mocked(hasApiKeys).mockReturnValue(true);

      const response = await request(app).get("/health");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "ok" });
    });
  });

  describe("open mode (no keys configured)", () => {
    it("allows requests when no API keys are configured", async () => {
      vi.mocked(hasApiKeys).mockReturnValue(false);

      const response = await request(app).get("/api/test");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ data: "protected" });
    });
  });

  describe("authenticated mode", () => {
    beforeEach(() => {
      vi.mocked(hasApiKeys).mockReturnValue(true);
    });

    it("returns 401 when no Authorization header is provided", async () => {
      const response = await request(app).get("/api/test");

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
      expect(response.body.error.message).toBe("API key required");
    });

    it("returns 401 when Authorization header is not Bearer format", async () => {
      const response = await request(app)
        .get("/api/test")
        .set("Authorization", "Basic abc123");

      expect(response.status).toBe(401);
      expect(response.body.error.message).toBe("API key required");
    });

    it("returns 401 when API key is invalid", async () => {
      vi.mocked(validateApiKey).mockReturnValue(false);

      const response = await request(app)
        .get("/api/test")
        .set("Authorization", "Bearer adj_invalid");

      expect(response.status).toBe(401);
      expect(response.body.error.message).toBe("Invalid API key");
    });

    it("allows request with valid API key", async () => {
      vi.mocked(validateApiKey).mockReturnValue(true);

      const response = await request(app)
        .get("/api/test")
        .set("Authorization", "Bearer adj_validkey");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ data: "protected" });
    });

    it("handles case-insensitive Bearer prefix", async () => {
      vi.mocked(validateApiKey).mockReturnValue(true);

      const response = await request(app)
        .get("/api/test")
        .set("Authorization", "bearer adj_validkey");

      expect(response.status).toBe(200);
    });
  });
});
