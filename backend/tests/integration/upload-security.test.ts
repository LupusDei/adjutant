/**
 * Integration: adversarial upload-security matrix (adj-203.6.2 / T017).
 *
 * Exercises the API boundary (real express + real UploadService over real
 * UploadStorage + AttachmentStore + apiKeyAuth) with hostile inputs. Each must be
 * rejected/denied and must not write anything outside the uploads dir:
 *
 *   1. path traversal   — a malicious multipart filename cannot escape the dir
 *   2. oversized        — > 10 MB is rejected (multer cap)
 *   3. disallowed MIME  — a non-image type is rejected
 *   4. magic-byte spoof — declared image/png but the bytes are not a PNG → rejected
 *   5. count cap        — > 4 attachmentIds on POST /api/messages → 400
 *   6. unauthenticated  — GET /api/uploads/:id without a key → 401
 *
 * Some of these are also covered at the unit layer; this is the end-to-end
 * adversarial suite over the HTTP surface.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runMigrations } from "../../src/services/database.js";
import { createAttachmentStore, type AttachmentStore } from "../../src/services/attachment-store.js";
import { createMessageStore, type MessageStore } from "../../src/services/message-store.js";
import { createUploadStorage } from "../../src/services/upload-storage.js";
import { createUploadService } from "../../src/services/upload-service.js";
import { createUploadsRouter } from "../../src/routes/uploads.js";
import { createMessagesRouter } from "../../src/routes/messages.js";
import { apiKeyAuth } from "../../src/middleware/api-key.js";
import { generateApiKey, listApiKeys, revokeApiKey } from "../../src/services/api-key-service.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);

let db: Database.Database;
let dir: string;
let attachmentStore: AttachmentStore;
let messageStore: MessageStore;
let app: Express;
let rawKey: string;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  attachmentStore = createAttachmentStore(db);
  messageStore = createMessageStore(db, { attachmentStore });
  dir = mkdtempSync(join(tmpdir(), "adj-upsec-"));
  const uploadService = createUploadService({
    storage: createUploadStorage({ uploadDir: dir }),
    attachmentStore,
  });

  app = express();
  app.use(express.json());
  // Whole surface behind apiKeyAuth (as in production).
  app.use(apiKeyAuth);
  app.use("/api/uploads", createUploadsRouter(uploadService));
  app.use("/api/messages", createMessagesRouter(messageStore));

  rawKey = generateApiKey("test-upsec");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  for (const k of listApiKeys()) revokeApiKey(k.hashPrefix);
});

function auth(req: request.Test): request.Test {
  return req.set("Authorization", `Bearer ${rawKey}`);
}

/** Every file written must live directly under the uploads dir (flat, uuid-named). */
function assertNothingEscaped(): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    expect(e.isFile()).toBe(true);
    expect(e.name).toMatch(/^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/);
  }
}

describe("upload security matrix (adj-203.6.2)", () => {
  it("1. neutralizes a path-traversal filename (server-generated name, nothing escapes)", async () => {
    const res = await auth(
      request(app)
        .post("/api/uploads")
        .attach("file", PNG, { filename: "../../../../etc/passwd.png", contentType: "image/png" }),
    );
    // A valid PNG is accepted, but stored under a server-generated safe name…
    expect(res.status).toBe(201);
    expect(res.body.data.filename).toBe("passwd.png"); // display name sanitized to basename
    // …and NOTHING was written outside the uploads dir.
    assertNothingEscaped();
  });

  it("2. rejects an oversized upload (> 10 MB)", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]);
    const res = await auth(
      request(app).post("/api/uploads").attach("file", big, { filename: "big.png", contentType: "image/png" }),
    );
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    assertNothingEscaped();
  });

  it("3. rejects a disallowed MIME (non-image bytes)", async () => {
    const res = await auth(
      request(app)
        .post("/api/uploads")
        .attach("file", Buffer.from("%PDF-1.7 not an image"), { filename: "x.png", contentType: "application/pdf" }),
    );
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("4. rejects a magic-byte spoof (declared image/png, bytes are not a PNG)", async () => {
    const res = await auth(
      request(app)
        .post("/api/uploads")
        .attach("file", Buffer.from("totally not a png"), { filename: "evil.png", contentType: "image/png" }),
    );
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("5. rejects more than 4 attachments on a message (per-message count cap)", async () => {
    // Five valid attachment rows, then try to link all five to one message.
    const ids = Array.from({ length: 5 }, (_, i) =>
      attachmentStore.createAttachment({
        kind: "image",
        storagePath: join(dir, `seed-${i}.png`),
        filename: `s${i}.png`,
        mimeType: "image/png",
        sizeBytes: PNG.length,
      }).id,
    );
    const res = await auth(
      request(app).post("/api/messages").send({ to: "raynor", body: "too many", attachmentIds: ids }),
    );
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("6. denies an UNAUTHENTICATED GET /api/uploads/:id (401, no bytes)", async () => {
    // First upload one (authenticated) to get a real id.
    const up = await auth(
      request(app).post("/api/uploads").attach("file", PNG, { filename: "s.png", contentType: "image/png" }),
    );
    const id = up.body.data.id as string;

    // No Authorization header → 401 (keys are configured).
    const res = await request(app).get(`/api/uploads/${id}`);
    expect(res.status).toBe(401);
    // Sanity: WITH the key it serves (200) — proving the 401 is auth, not a broken id.
    const ok = await auth(request(app).get(`/api/uploads/${id}`));
    expect(ok.status).toBe(200);
  });
});
