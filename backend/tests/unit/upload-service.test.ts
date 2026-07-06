/**
 * Tests for UploadService (adj-203.2.1).
 *
 * Orchestrates validate → store file → attachment row. Uses REAL collaborators
 * (real UploadStorage over a temp dir, real AttachmentStore over in-memory SQLite)
 * so the test exercises the true integration and real data shapes (adj-067 rule).
 *
 * Coverage (≥3): happy path, rejects bad MIME, rejects oversized, sanitizes the
 * client filename, exposes getById for the serve route.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { runMigrations } from "../../src/services/database.js";
import { createAttachmentStore } from "../../src/services/attachment-store.js";
import { createUploadStorage, MAX_UPLOAD_BYTES } from "../../src/services/upload-storage.js";
import {
  createUploadService,
  UploadValidationError,
  type UploadService,
} from "../../src/services/upload-service.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const NOT_IMAGE = Buffer.from("just some text, not an image", "utf8");

let db: Database.Database;
let dir: string;
let service: UploadService;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  dir = mkdtempSync(join(tmpdir(), "adj-uploadsvc-"));
  service = createUploadService({
    storage: createUploadStorage({ uploadDir: dir }),
    attachmentStore: createAttachmentStore(db),
  });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("UploadService.upload", () => {
  it("should validate, write the file, insert an attachment row, and return its metadata", () => {
    const result = service.upload({ buffer: PNG, filename: "shot.png", declaredMime: "image/png" });
    expect(result.id).toBeTruthy();
    expect(result.filename).toBe("shot.png");
    expect(result.mimeType).toBe("image/png");
    expect(result.sizeBytes).toBe(PNG.length);

    // file exists on disk, under the uploads dir, with the original bytes
    const row = service.getById(result.id);
    expect(row).not.toBeNull();
    expect(dirname(row!.storagePath)).toBe(dir);
    expect(existsSync(row!.storagePath)).toBe(true);
    expect(readFileSync(row!.storagePath).equals(PNG)).toBe(true);
    expect(row!.messageId).toBeNull(); // unlinked until message send
  });

  it("should reject a disallowed type with an UploadValidationError (no file written)", () => {
    let caught: unknown;
    try {
      service.upload({ buffer: NOT_IMAGE, filename: "evil.png", declaredMime: "image/png" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UploadValidationError);
    expect((caught as UploadValidationError).code).toBe("unsupported-type");
    // nothing persisted, nothing written
    expect(db.prepare("SELECT COUNT(*) c FROM message_attachments").get()).toMatchObject({ c: 0 });
  });

  it("should reject an oversized upload", () => {
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES + 1)]);
    expect(() => service.upload({ buffer: big, filename: "big.png" })).toThrow(UploadValidationError);
    expect(() => service.upload({ buffer: big, filename: "big.png" })).toThrow(/exceed/i);
  });

  it("should reject when declared mime disagrees with the sniffed bytes", () => {
    // real jpeg bytes but claims webp
    const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    try {
      service.upload({ buffer: JPEG, filename: "x.webp", declaredMime: "image/webp" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UploadValidationError);
      expect((e as UploadValidationError).code).toBe("mime-mismatch");
    }
  });

  it("should sanitize a client filename with path components to its basename", () => {
    const result = service.upload({ buffer: PNG, filename: "../../etc/passwd.png" });
    expect(result.filename).toBe("passwd.png");
  });

  it("should fall back to a safe default filename when none is provided", () => {
    const result = service.upload({ buffer: PNG });
    // defaults to the stored name (<uuid>.png)
    expect(result.filename).toMatch(/\.png$/);
    expect(result.filename).not.toContain("/");
  });
});

describe("UploadService.getById", () => {
  it("should return the attachment row for a known id", () => {
    const r = service.upload({ buffer: PNG, filename: "a.png" });
    expect(service.getById(r.id)?.id).toBe(r.id);
  });

  it("should return null for an unknown id", () => {
    expect(service.getById("missing")).toBeNull();
  });
});

describe("UploadService.getFileForServe", () => {
  it("should return mime + size + a stream of the stored bytes", async () => {
    const r = service.upload({ buffer: PNG, filename: "a.png" });
    const served = service.getFileForServe(r.id);
    expect(served).not.toBeNull();
    expect(served!.mimeType).toBe("image/png");
    expect(served!.sizeBytes).toBe(PNG.length);
    const chunks: Buffer[] = [];
    await new Promise<void>((res, rej) => {
      served!.stream
        .on("data", (c: Buffer) => chunks.push(c))
        .on("end", () => res())
        .on("error", rej);
    });
    expect(Buffer.concat(chunks).equals(PNG)).toBe(true);
  });

  it("should return null for an unknown id", () => {
    expect(service.getFileForServe("missing")).toBeNull();
  });

  it("should return null when the backing file was removed (no existence leak)", () => {
    const r = service.upload({ buffer: PNG, filename: "a.png" });
    const path = service.getById(r.id)!.storagePath;
    rmSync(path, { force: true });
    expect(service.getFileForServe(r.id)).toBeNull();
  });
});
