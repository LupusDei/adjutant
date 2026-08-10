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
  const dir = join(tmpdir(), `adjutant-artifactroute-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

async function createArtifactViaApi(body: Record<string, unknown>): Promise<string> {
  const res = await request(app).post("/api/artifacts").send(body);
  return res.body.data.id as string;
}

describe("artifacts-routes", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();

    const { createArtifactStore } = await import("../../src/services/artifact-store.js");
    const { createArtifactsRouter } = await import("../../src/routes/artifacts.js");
    const store = createArtifactStore(db);

    app = express();
    app.use(express.json());
    app.use("/api/artifacts", createArtifactsRouter(store));
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("POST /api/artifacts", () => {
    it("should create an artifact and return 201", async () => {
      const res = await request(app)
        .post("/api/artifacts")
        .send({ title: "My Page", html: "<h1>Hi</h1>", description: "d" });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe("My Page");
      expect(res.body.data.id).toBeTruthy();
      expect(res.body.data.isPublic).toBe(false);
    });

    it("should reject a missing title with 400", async () => {
      const res = await request(app).post("/api/artifacts").send({ html: "<h1>Hi</h1>" });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should reject a missing html with 400", async () => {
      const res = await request(app).post("/api/artifacts").send({ title: "No body" });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /api/artifacts", () => {
    it("should list artifacts newest-first", async () => {
      const id1 = await createArtifactViaApi({ title: "One", html: "<p>1</p>" });
      const id2 = await createArtifactViaApi({ title: "Two", html: "<p>2</p>" });

      const res = await request(app).get("/api/artifacts");
      expect(res.status).toBe(200);
      expect(res.body.data.map((a: { id: string }) => a.id)).toEqual([id2, id1]);
    });

    it("should return an empty array when none exist", async () => {
      const res = await request(app).get("/api/artifacts");
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe("GET /api/artifacts/:id", () => {
    it("should return an artifact by id", async () => {
      const id = await createArtifactViaApi({ title: "Get", html: "<p>g</p>" });
      const res = await request(app).get(`/api/artifacts/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(id);
    });

    it("should 404 for unknown id", async () => {
      const res = await request(app).get("/api/artifacts/nope");
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("PATCH /api/artifacts/:id", () => {
    it("should update fields and return 200", async () => {
      const id = await createArtifactViaApi({ title: "Old", html: "<p>o</p>" });
      const res = await request(app).patch(`/api/artifacts/${id}`).send({ title: "New" });
      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe("New");
    });

    it("should 404 for unknown id", async () => {
      const res = await request(app).patch("/api/artifacts/nope").send({ title: "x" });
      expect(res.status).toBe(404);
    });

    it("should 400 for an empty update body", async () => {
      const id = await createArtifactViaApi({ title: "T", html: "<p>t</p>" });
      const res = await request(app).patch(`/api/artifacts/${id}`).send({});
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/artifacts/:id", () => {
    it("should delete an artifact and return 200", async () => {
      const id = await createArtifactViaApi({ title: "Del", html: "<p>d</p>" });
      const res = await request(app).delete(`/api/artifacts/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const after = await request(app).get(`/api/artifacts/${id}`);
      expect(after.status).toBe(404);
    });

    it("should 404 when deleting an unknown id", async () => {
      const res = await request(app).delete("/api/artifacts/nope");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/artifacts/:id/publish", () => {
    it("should publish and return a full /a/:token public URL", async () => {
      const id = await createArtifactViaApi({ title: "Pub", html: "<p>p</p>" });
      const res = await request(app).post(`/api/artifacts/${id}/publish`);

      expect(res.status).toBe(200);
      expect(res.body.data.artifact.isPublic).toBe(true);
      const token = res.body.data.artifact.shareToken as string;
      expect(token).toBeTruthy();
      expect(res.body.data.publicUrl).toContain(`/a/${token}`);
    });

    it("should 404 when publishing an unknown id", async () => {
      const res = await request(app).post("/api/artifacts/nope/publish");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/artifacts/:id/unpublish", () => {
    it("should unpublish and return the artifact", async () => {
      const id = await createArtifactViaApi({ title: "U", html: "<p>u</p>" });
      await request(app).post(`/api/artifacts/${id}/publish`);
      const res = await request(app).post(`/api/artifacts/${id}/unpublish`);

      expect(res.status).toBe(200);
      expect(res.body.data.artifact.isPublic).toBe(false);
    });

    it("should 404 when unpublishing an unknown id", async () => {
      const res = await request(app).post("/api/artifacts/nope/unpublish");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/artifacts/:id/download", () => {
    it("should serve the composed document as an attachment", async () => {
      const id = await createArtifactViaApi({ title: "Report", html: "<h1>Report</h1>", slug: "quarterly-report" });
      const res = await request(app).get(`/api/artifacts/${id}/download`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.headers["content-disposition"]).toContain("attachment");
      expect(res.headers["content-disposition"]).toContain("quarterly-report.html");
      expect(res.text).toMatch(/^<!DOCTYPE html>/i);
      expect(res.text).toContain("<h1>Report</h1>");
    });

    it("should derive a filename from the title when no slug is set", async () => {
      const id = await createArtifactViaApi({ title: "Hello World Page", html: "<p>x</p>" });
      const res = await request(app).get(`/api/artifacts/${id}/download`);

      expect(res.status).toBe(200);
      expect(res.headers["content-disposition"]).toContain("hello-world-page.html");
    });

    it("should 404 for an unknown id", async () => {
      const res = await request(app).get("/api/artifacts/nope/download");
      expect(res.status).toBe(404);
    });
  });
});
