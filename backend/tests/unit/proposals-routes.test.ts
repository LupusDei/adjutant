import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import request from "supertest";
import type Database from "better-sqlite3";

let testDir: string;
let db: Database.Database;
let app: express.Express;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-proposalroute-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

describe("proposals-routes", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();

    const { createProposalStore } = await import("../../src/services/proposal-store.js");
    const { createProposalsRouter } = await import("../../src/routes/proposals.js");
    const store = createProposalStore(db);

    app = express();
    app.use(express.json());
    app.use("/api/proposals", createProposalsRouter(store));
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("POST /api/proposals", () => {
    it("should create a proposal and return 201", async () => {
      const res = await request(app)
        .post("/api/proposals")
        .send({
          author: "test-agent",
          title: "Improve caching",
          description: "Add Redis caching layer for frequently accessed data.",
          type: "engineering",
          project: "adjutant",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe("Improve caching");
      expect(res.body.data.status).toBe("pending");
      expect(res.body.data.id).toBeTruthy();
    });

    it("should reject missing author with 400", async () => {
      const res = await request(app)
        .post("/api/proposals")
        .send({
          title: "Test",
          description: "Desc",
          type: "product",
          project: "adjutant",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should reject missing project with 400", async () => {
      const res = await request(app)
        .post("/api/proposals")
        .send({
          author: "agent",
          title: "Test",
          description: "Desc",
          type: "product",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should reject invalid type with 400", async () => {
      const res = await request(app)
        .post("/api/proposals")
        .send({
          author: "agent",
          title: "Test",
          description: "Desc",
          type: "invalid",
          project: "adjutant",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /api/proposals", () => {
    it("should list proposals", async () => {
      await request(app).post("/api/proposals").send({
        author: "agent-1",
        title: "Proposal 1",
        description: "Desc 1",
        type: "product",
        project: "adjutant",
      });

      const res = await request(app).get("/api/proposals");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });

    it("should filter by status", async () => {
      const createRes = await request(app).post("/api/proposals").send({
        author: "agent-1",
        title: "P1",
        description: "D1",
        type: "product",
        project: "adjutant",
      });

      await request(app)
        .patch(`/api/proposals/${createRes.body.data.id}`)
        .send({ status: "accepted" });

      const pendingRes = await request(app).get("/api/proposals?status=pending");
      expect(pendingRes.body.data).toHaveLength(0);

      const acceptedRes = await request(app).get("/api/proposals?status=accepted");
      expect(acceptedRes.body.data).toHaveLength(1);
    });

    it("should filter by type", async () => {
      await request(app).post("/api/proposals").send({
        author: "a", title: "P1", description: "D1", type: "product", project: "adjutant",
      });
      await request(app).post("/api/proposals").send({
        author: "b", title: "P2", description: "D2", type: "engineering", project: "adjutant",
      });

      const res = await request(app).get("/api/proposals?type=engineering");
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].type).toBe("engineering");
    });

    it("should filter by project", async () => {
      await request(app).post("/api/proposals").send({
        author: "a", title: "P1", description: "D1", type: "product", project: "adjutant",
      });
      await request(app).post("/api/proposals").send({
        author: "b", title: "P2", description: "D2", type: "engineering", project: "gastown",
      });
      await request(app).post("/api/proposals").send({
        author: "c", title: "P3", description: "D3", type: "product", project: "adjutant",
      });

      const res = await request(app).get("/api/proposals?project=adjutant");
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((p: { project: string }) => p.project === "adjutant")).toBe(true);
    });

    it("should include project in response", async () => {
      await request(app).post("/api/proposals").send({
        author: "agent-1", title: "Test", description: "Desc", type: "product", project: "gastown",
      });

      const res = await request(app).get("/api/proposals");
      expect(res.body.data[0].project).toBe("gastown");
    });
  });

  describe("GET /api/proposals/:id", () => {
    it("should return a single proposal", async () => {
      const createRes = await request(app).post("/api/proposals").send({
        author: "agent-1",
        title: "Specific Proposal",
        description: "Details",
        type: "product",
        project: "adjutant",
      });

      const res = await request(app).get(`/api/proposals/${createRes.body.data.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe("Specific Proposal");
    });

    it("should return 404 for non-existent ID", async () => {
      const res = await request(app).get("/api/proposals/non-existent");
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/proposals/:id", () => {
    it("should accept a proposal", async () => {
      const createRes = await request(app).post("/api/proposals").send({
        author: "agent-1",
        title: "To Accept",
        description: "Will be accepted",
        type: "product",
        project: "adjutant",
      });

      const res = await request(app)
        .patch(`/api/proposals/${createRes.body.data.id}`)
        .send({ status: "accepted" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("accepted");
    });

    it("should dismiss a proposal", async () => {
      const createRes = await request(app).post("/api/proposals").send({
        author: "agent-1",
        title: "To Dismiss",
        description: "Will be dismissed",
        type: "engineering",
        project: "gastown",
      });

      const res = await request(app)
        .patch(`/api/proposals/${createRes.body.data.id}`)
        .send({ status: "dismissed" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("dismissed");
    });

    it("should reject invalid status with 400", async () => {
      const createRes = await request(app).post("/api/proposals").send({
        author: "agent-1",
        title: "Test",
        description: "Desc",
        type: "product",
        project: "adjutant",
      });

      const res = await request(app)
        .patch(`/api/proposals/${createRes.body.data.id}`)
        .send({ status: "invalid" });

      expect(res.status).toBe(400);
    });

    it("should return 404 for non-existent ID", async () => {
      const res = await request(app)
        .patch("/api/proposals/non-existent")
        .send({ status: "accepted" });

      expect(res.status).toBe(404);
    });
  });
});
