/**
 * Integration tests for the project style-guide REST API (adj-201.1.3).
 *
 * Exercises route → service → SQLite end-to-end over a real in-memory DB:
 *  - GET /api/projects/:id/style-guide   → set + unset guide, 404 on unknown id
 *  - PUT /api/projects/:id/style-guide   → persist, invalid-hex 400, unknown-id 404,
 *                                          clear-when-primary-empty
 *
 * The real projects-service + router run; only the database singleton is pointed
 * at an in-memory DB so we prove the wiring and the locked validation contract at
 * the HTTP boundary (no service mocking — this is a true integration test).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import supertest from "supertest";
import Database from "better-sqlite3";

// Point the database singleton at a per-test in-memory DB. The real service and
// real router run against it — this is integration, not a service mock.
let testDb: Database.Database;
vi.mock("../../src/services/database.js", () => ({
  getDatabase: () => testDb,
  createDatabase: () => testDb,
  runMigrations: () => {},
}));

import { createProjectsRouter } from "../../src/routes/projects.js";
import type { MessageStore } from "../../src/services/message-store.js";

// The style-guide routes never touch the message store; a minimal stub suffices
// for the router factory.
const mockStore = {
  getUnreadCounts: vi.fn().mockReturnValue([]),
  getUnreadSummaries: vi.fn().mockReturnValue([]),
} as unknown as MessageStore;

function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/projects", createProjectsRouter(mockStore));
  return app;
}

function seedProject(id: string): void {
  testDb
    .prepare(
      "INSERT INTO projects (id, name, path, git_remote, mode, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(id, `proj-${id}`, `/path/${id}`, null, "swarm", "2026-01-01T00:00:00.000Z");
}

let app: Express;

beforeEach(() => {
  testDb = new Database(":memory:");
  testDb.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      git_remote TEXT,
      mode TEXT NOT NULL DEFAULT 'swarm',
      created_at TEXT NOT NULL,
      auto_develop INTEGER NOT NULL DEFAULT 0,
      auto_develop_paused_at TEXT,
      vision_context TEXT,
      auto_develop_product_owner TEXT,
      brand_color_primary TEXT,
      brand_color_secondary TEXT
    )
  `);
  app = createTestApp();
});

afterEach(() => {
  if (testDb) testDb.close();
  vi.clearAllMocks();
});

describe("GET /api/projects/:id/style-guide", () => {
  it("should return the stored brand colors when a guide is set", async () => {
    seedProject("g1");
    testDb
      .prepare("UPDATE projects SET brand_color_primary = ?, brand_color_secondary = ? WHERE id = ?")
      .run("#00ff00", "#0a0a0a", "g1");

    const res = await supertest(app).get("/api/projects/g1/style-guide");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ brandColorPrimary: "#00ff00", brandColorSecondary: "#0a0a0a" });
  });

  it("should return null colors when no guide is set (valid unset state)", async () => {
    seedProject("g2");

    const res = await supertest(app).get("/api/projects/g2/style-guide");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ brandColorPrimary: null, brandColorSecondary: null });
  });

  it("should return 404 for an unknown project", async () => {
    const res = await supertest(app).get("/api/projects/nope/style-guide");

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe("PUT /api/projects/:id/style-guide", () => {
  it("should persist primary and secondary and reflect them on a subsequent GET", async () => {
    seedProject("p1");

    const put = await supertest(app)
      .put("/api/projects/p1/style-guide")
      .send({ primary: "#00FF00", secondary: "#0a0a0a" });
    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);

    const get = await supertest(app).get("/api/projects/p1/style-guide");
    expect(get.body.data).toEqual({ brandColorPrimary: "#00FF00", brandColorSecondary: "#0a0a0a" });
  });

  it("should persist primary alone when secondary is omitted", async () => {
    seedProject("p2");

    const put = await supertest(app).put("/api/projects/p2/style-guide").send({ primary: "#abc" });
    expect(put.status).toBe(200);

    const get = await supertest(app).get("/api/projects/p2/style-guide");
    expect(get.body.data).toEqual({ brandColorPrimary: "#abc", brandColorSecondary: null });
  });

  it("should return 400 for invalid hex", async () => {
    seedProject("p3");

    const res = await supertest(app)
      .put("/api/projects/p3/style-guide")
      .send({ primary: "green" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("should return 404 for an unknown project", async () => {
    const res = await supertest(app)
      .put("/api/projects/nope/style-guide")
      .send({ primary: "#00ff00" });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("should clear the whole guide when primary is empty", async () => {
    seedProject("p4");
    testDb
      .prepare("UPDATE projects SET brand_color_primary = ?, brand_color_secondary = ? WHERE id = ?")
      .run("#111", "#222", "p4");

    const put = await supertest(app).put("/api/projects/p4/style-guide").send({ primary: "" });
    expect(put.status).toBe(200);

    const get = await supertest(app).get("/api/projects/p4/style-guide");
    expect(get.body.data).toEqual({ brandColorPrimary: null, brandColorSecondary: null });
  });

  it("should return 400 when primary is missing from the body", async () => {
    seedProject("p5");

    const res = await supertest(app).put("/api/projects/p5/style-guide").send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
