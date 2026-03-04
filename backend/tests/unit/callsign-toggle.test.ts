import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import request from "supertest";
import type Database from "better-sqlite3";

import type { CallsignToggleService } from "../../src/services/callsign-toggle-service.js";
import { CALLSIGNS } from "../../src/services/callsign-service.js";

// ============================================================================
// Helpers
// ============================================================================

let testDir: string;
let db: Database.Database;
let service: CallsignToggleService;

function freshTestDir(): string {
  const dir = join(
    tmpdir(),
    `adjutant-callsigntoggle-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

// ============================================================================
// CallsignToggleService Unit Tests
// ============================================================================

describe("CallsignToggleService", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
    const { createCallsignToggleService } = await import(
      "../../src/services/callsign-toggle-service.js"
    );
    service = createCallsignToggleService(db);
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("isEnabled", () => {
    it("should return true for a callsign with no settings row (default enabled)", () => {
      expect(service.isEnabled("raynor")).toBe(true);
    });

    it("should return false for a disabled callsign", () => {
      service.setEnabled("raynor", false);
      expect(service.isEnabled("raynor")).toBe(false);
    });

    it("should return true for a re-enabled callsign", () => {
      service.setEnabled("raynor", false);
      service.setEnabled("raynor", true);
      expect(service.isEnabled("raynor")).toBe(true);
    });
  });

  describe("setEnabled", () => {
    it("should disable a callsign", () => {
      service.setEnabled("zeratul", false);
      expect(service.isEnabled("zeratul")).toBe(false);
    });

    it("should enable a previously disabled callsign", () => {
      service.setEnabled("zeratul", false);
      service.setEnabled("zeratul", true);
      expect(service.isEnabled("zeratul")).toBe(true);
    });

    it("should handle setting the same state multiple times", () => {
      service.setEnabled("zeratul", false);
      service.setEnabled("zeratul", false);
      expect(service.isEnabled("zeratul")).toBe(false);
    });
  });

  describe("isMasterEnabled", () => {
    it("should return true by default (no row)", () => {
      expect(service.isMasterEnabled()).toBe(true);
    });

    it("should return false when master is disabled", () => {
      service.setMasterEnabled(false);
      expect(service.isMasterEnabled()).toBe(false);
    });
  });

  describe("setMasterEnabled", () => {
    it("should disable master toggle", () => {
      service.setMasterEnabled(false);
      expect(service.isMasterEnabled()).toBe(false);
    });

    it("should re-enable master toggle", () => {
      service.setMasterEnabled(false);
      service.setMasterEnabled(true);
      expect(service.isMasterEnabled()).toBe(true);
    });
  });

  describe("getDisabledCallsigns", () => {
    it("should return empty set when nothing is disabled", () => {
      expect(service.getDisabledCallsigns().size).toBe(0);
    });

    it("should return disabled callsigns", () => {
      service.setEnabled("raynor", false);
      service.setEnabled("zeratul", false);
      const disabled = service.getDisabledCallsigns();
      expect(disabled.has("raynor")).toBe(true);
      expect(disabled.has("zeratul")).toBe(true);
      expect(disabled.size).toBe(2);
    });

    it("should not include re-enabled callsigns", () => {
      service.setEnabled("raynor", false);
      service.setEnabled("raynor", true);
      expect(service.getDisabledCallsigns().size).toBe(0);
    });

    it("should not include master toggle row in disabled set", () => {
      service.setMasterEnabled(false);
      // Master toggle uses __master__ key, should not appear in callsign disabled list
      expect(service.getDisabledCallsigns().has("__master__")).toBe(false);
    });
  });

  describe("getAllSettings", () => {
    it("should return all 44 callsigns with enabled/disabled status", () => {
      const settings = service.getAllSettings();
      expect(settings).toHaveLength(44);
      expect(settings.every((s) => s.enabled === true)).toBe(true);
    });

    it("should reflect disabled callsigns", () => {
      service.setEnabled("raynor", false);
      service.setEnabled("artanis", false);

      const settings = service.getAllSettings();
      const raynor = settings.find((s) => s.name === "raynor");
      const artanis = settings.find((s) => s.name === "artanis");
      const nova = settings.find((s) => s.name === "nova");

      expect(raynor?.enabled).toBe(false);
      expect(artanis?.enabled).toBe(false);
      expect(nova?.enabled).toBe(true);
    });

    it("should include master toggle status", () => {
      const settings = service.getAllSettings();
      // getAllSettings returns callsign entries; masterEnabled is separate
      // Check that the return shape includes masterEnabled in the response
    });
  });

  describe("setAllEnabled", () => {
    it("should disable all callsigns", () => {
      service.setAllEnabled(false);
      const disabled = service.getDisabledCallsigns();
      expect(disabled.size).toBe(44);
    });

    it("should re-enable all callsigns", () => {
      service.setAllEnabled(false);
      service.setAllEnabled(true);
      const disabled = service.getDisabledCallsigns();
      expect(disabled.size).toBe(0);
    });

    it("should work even when some are already disabled", () => {
      service.setEnabled("raynor", false);
      service.setAllEnabled(false);
      const disabled = service.getDisabledCallsigns();
      expect(disabled.size).toBe(44);
    });
  });
});

// ============================================================================
// Callsign Routes Tests
// ============================================================================

describe("callsigns-routes", () => {
  let app: express.Express;

  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();

    const { createCallsignToggleService } = await import(
      "../../src/services/callsign-toggle-service.js"
    );
    const { createCallsignsRouter } = await import("../../src/routes/callsigns.js");
    service = createCallsignToggleService(db);

    app = express();
    app.use(express.json());
    app.use("/api/callsigns", createCallsignsRouter(service));
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("GET /api/callsigns", () => {
    it("should return all callsigns with enabled status", async () => {
      const res = await request(app).get("/api/callsigns");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.callsigns).toHaveLength(44);
      expect(res.body.data.masterEnabled).toBe(true);
      expect(res.body.data.callsigns[0]).toHaveProperty("name");
      expect(res.body.data.callsigns[0]).toHaveProperty("race");
      expect(res.body.data.callsigns[0]).toHaveProperty("enabled");
    });

    it("should reflect disabled callsigns", async () => {
      service.setEnabled("raynor", false);

      const res = await request(app).get("/api/callsigns");
      const raynor = res.body.data.callsigns.find(
        (c: { name: string }) => c.name === "raynor",
      );
      expect(raynor.enabled).toBe(false);
    });
  });

  describe("PUT /api/callsigns/:name/toggle", () => {
    it("should disable a callsign", async () => {
      const res = await request(app)
        .put("/api/callsigns/raynor/toggle")
        .send({ enabled: false });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("raynor");
      expect(res.body.data.enabled).toBe(false);
    });

    it("should enable a callsign", async () => {
      service.setEnabled("raynor", false);

      const res = await request(app)
        .put("/api/callsigns/raynor/toggle")
        .send({ enabled: true });

      expect(res.status).toBe(200);
      expect(res.body.data.enabled).toBe(true);
    });

    it("should return 400 when enabled is not a boolean", async () => {
      const res = await request(app)
        .put("/api/callsigns/raynor/toggle")
        .send({ enabled: "yes" });

      expect(res.status).toBe(400);
    });

    it("should return 400 for unknown callsign name", async () => {
      const res = await request(app)
        .put("/api/callsigns/unknown-agent/toggle")
        .send({ enabled: false });

      expect(res.status).toBe(400);
    });
  });

  describe("PUT /api/callsigns/toggle-all", () => {
    it("should disable all callsigns", async () => {
      const res = await request(app)
        .put("/api/callsigns/toggle-all")
        .send({ enabled: false });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.masterEnabled).toBe(false);
    });

    it("should re-enable all callsigns", async () => {
      service.setAllEnabled(false);

      const res = await request(app)
        .put("/api/callsigns/toggle-all")
        .send({ enabled: true });

      expect(res.status).toBe(200);
      expect(res.body.data.masterEnabled).toBe(true);
    });

    it("should return 400 when enabled is missing", async () => {
      const res = await request(app)
        .put("/api/callsigns/toggle-all")
        .send({});

      expect(res.status).toBe(400);
    });
  });
});
