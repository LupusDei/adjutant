import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import request from "supertest";
import type Database from "better-sqlite3";
import type { ArtifactStore } from "../../src/services/artifact-store.js";

let testDir: string;
let db: Database.Database;
let app: express.Express;
let store: ArtifactStore;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-pubartifact-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

/** Create + publish an artifact, returning its share token. */
function publishArtifact(html = "<h1>Public Page</h1>", title = "Pub"): string {
  const created = store.createArtifact({ title, html, slug: "public-page" });
  const published = store.publishArtifact(created.id);
  return published?.shareToken ?? "";
}

describe("public-artifacts-routes", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();

    const { createArtifactStore } = await import("../../src/services/artifact-store.js");
    const { createPublicArtifactsRouter } = await import("../../src/routes/public-artifacts.js");
    store = createArtifactStore(db);

    app = express();
    app.use("/a", createPublicArtifactsRouter(store));
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("GET /a/:token", () => {
    it("should serve the composed document for a published artifact (200, text/html)", async () => {
      const token = publishArtifact();
      const res = await request(app).get(`/a/${token}`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.text).toMatch(/^<!DOCTYPE html>/i);
      expect(res.text).toContain("<h1>Public Page</h1>");
    });

    it("should set a strict Content-Security-Policy header", async () => {
      const token = publishArtifact();
      const res = await request(app).get(`/a/${token}`);
      expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    });

    it("should 404 for an unknown token", async () => {
      const res = await request(app).get("/a/does-not-exist");
      expect(res.status).toBe(404);
      expect(res.headers["content-type"]).toContain("text/html");
    });

    it("should 404 for an unpublished token without leaking existence", async () => {
      const token = publishArtifact();
      // Find the artifact and unpublish it.
      const artifact = store.getArtifactByToken(token);
      // Token no longer resolves once unpublished — but simulate a client holding the token.
      const created = store.listArtifacts()[0];
      store.unpublishArtifact(created!.id);

      const res = await request(app).get(`/a/${token}`);
      expect(res.status).toBe(404);
      // Body must NOT echo the token or any identifier.
      expect(res.text).not.toContain(token);
      expect(artifact).not.toBeNull(); // sanity: it existed before unpublish
    });
  });

  describe("GET /a/:token/download", () => {
    it("should serve the composed document as an attachment", async () => {
      const token = publishArtifact();
      const res = await request(app).get(`/a/${token}/download`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.headers["content-disposition"]).toContain("attachment");
      expect(res.headers["content-disposition"]).toContain("public-page.html");
      expect(res.text).toMatch(/^<!DOCTYPE html>/i);
      expect(res.text).toContain("<h1>Public Page</h1>");
    });

    it("should 404 downloading an unknown token", async () => {
      const res = await request(app).get("/a/nope/download");
      expect(res.status).toBe(404);
    });
  });
});
