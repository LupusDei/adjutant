/**
 * Tests for the uploads REST routes (adj-203.2.2).
 *
 * POST /api/uploads (multipart) and GET /api/uploads/:id (authenticated stream).
 * Uses supertest against a real express app wiring the real UploadService over a
 * real UploadStorage (temp dir) + real AttachmentStore (in-memory SQLite) — so the
 * multipart parse → validate → write → row → serve path is exercised end to end.
 *
 * Coverage: POST success (201 + metadata), POST validation error (400 disallowed
 * type), POST oversized (413/400), POST missing file (400); GET streams the stored
 * bytes, GET 404 unknown, GET behind apiKeyAuth (401 without key).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runMigrations } from "../../src/services/database.js";
import { createAttachmentStore } from "../../src/services/attachment-store.js";
import { createUploadStorage } from "../../src/services/upload-storage.js";
import { createUploadService } from "../../src/services/upload-service.js";
import { createUploadsRouter } from "../../src/routes/uploads.js";
import { apiKeyAuth } from "../../src/middleware/api-key.js";
import { generateApiKey, listApiKeys, revokeApiKey } from "../../src/services/api-key-service.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);

let db: Database.Database;
let dir: string;

function makeApp(withAuth = false): express.Express {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  dir = mkdtempSync(join(tmpdir(), "adj-uploadroutes-"));
  const service = createUploadService({
    storage: createUploadStorage({ uploadDir: dir }),
    attachmentStore: createAttachmentStore(db),
  });
  const app = express();
  if (withAuth) app.use(apiKeyAuth);
  app.use("/api/uploads", createUploadsRouter(service));
  return app;
}

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/uploads", () => {
  let app: express.Express;
  beforeEach(() => {
    app = makeApp();
  });

  it("should accept a valid PNG and return 201 with metadata", async () => {
    const res = await request(app)
      .post("/api/uploads")
      .attach("file", PNG, { filename: "shot.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.filename).toBe("shot.png");
    expect(res.body.data.mimeType).toBe("image/png");
    expect(res.body.data.sizeBytes).toBe(PNG.length);
  });

  it("should reject a non-image with a 400 validation error", async () => {
    const res = await request(app)
      .post("/api/uploads")
      .attach("file", Buffer.from("not an image"), { filename: "x.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBeTruthy();
  });

  it("should reject a request with no file (400)", async () => {
    const res = await request(app).post("/api/uploads").field("nothing", "here");
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("should reject an oversized upload (multer file-size cap)", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]);
    const res = await request(app)
      .post("/api/uploads")
      .attach("file", big, { filename: "big.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe("GET /api/uploads/:id", () => {
  it("should stream back the stored image bytes with the right content-type", async () => {
    const app = makeApp();
    const up = await request(app)
      .post("/api/uploads")
      .attach("file", PNG, { filename: "shot.png", contentType: "image/png" });
    const id = up.body.data.id as string;

    const res = await request(app).get(`/api/uploads/${id}`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect((res.body as Buffer).equals(PNG)).toBe(true);
  });

  it("should 404 an unknown id", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/uploads/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("should be protected by apiKeyAuth (401 without a key when keys are configured)", async () => {
    const app = makeApp(true);
    const rawKey = generateApiKey("test-uploads");
    try {
      // no Authorization header → 401
      const noKey = await request(app).get("/api/uploads/any-id");
      expect(noKey.status).toBe(401);
      // valid key → passes auth (404 because the id is unknown, but NOT 401)
      const withKey = await request(app)
        .get("/api/uploads/any-id")
        .set("Authorization", `Bearer ${rawKey}`);
      expect(withKey.status).toBe(404);
    } finally {
      for (const k of listApiKeys()) revokeApiKey(k.hashPrefix);
    }
  });
});
