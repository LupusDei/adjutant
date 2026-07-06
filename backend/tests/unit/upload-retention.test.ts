/**
 * Tests for the upload retention sweep (adj-203.6.1 / T016).
 *
 * Prunes stored files AND their attachment rows older than ADJUTANT_UPLOAD_TTL_DAYS
 * (default 7) and logs the pruned count — no silent truncation. Uses real
 * collaborators (real AttachmentStore over in-memory SQLite, real UploadStorage over
 * a temp dir) so the file + row deletion is exercised for real (adj-067 rule).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runMigrations } from "../../src/services/database.js";
import { createAttachmentStore, type AttachmentStore } from "../../src/services/attachment-store.js";
import { createUploadStorage, type UploadStorage } from "../../src/services/upload-storage.js";
import {
  pruneOldUploads,
  resolveUploadTtlDays,
  DEFAULT_UPLOAD_TTL_DAYS,
} from "../../src/services/upload-retention.js";
import * as logger from "../../src/utils/logger.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

let db: Database.Database;
let dir: string;
let attachmentStore: AttachmentStore;
let storage: UploadStorage;

/** Create a real stored file + attachment row, then age the row to `daysAgo`. */
function seedAttachment(daysAgo: number): { id: string; storagePath: string } {
  const name = storage.generateStoredName("png");
  const storagePath = storage.write(PNG, name);
  const a = attachmentStore.createAttachment({
    kind: "image",
    storagePath,
    filename: name,
    mimeType: "image/png",
    sizeBytes: PNG.length,
  });
  db.prepare("UPDATE message_attachments SET created_at = datetime('now', ?) WHERE id = ?").run(
    `-${daysAgo} days`,
    a.id,
  );
  return { id: a.id, storagePath };
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  attachmentStore = createAttachmentStore(db);
  dir = mkdtempSync(join(tmpdir(), "adj-retention-"));
  storage = createUploadStorage({ uploadDir: dir });
  storage.ensureDir();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("resolveUploadTtlDays", () => {
  const KEY = "ADJUTANT_UPLOAD_TTL_DAYS";
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env[KEY];
  });
  afterEach(() => {
    if (prev === undefined) delete process.env["ADJUTANT_UPLOAD_TTL_DAYS"];
    else process.env["ADJUTANT_UPLOAD_TTL_DAYS"] = prev;
  });

  it("should default to 7 days when unset", () => {
    delete process.env["ADJUTANT_UPLOAD_TTL_DAYS"];
    expect(resolveUploadTtlDays()).toBe(7);
    expect(DEFAULT_UPLOAD_TTL_DAYS).toBe(7);
  });

  it("should honor a positive integer override", () => {
    process.env["ADJUTANT_UPLOAD_TTL_DAYS"] = "14";
    expect(resolveUploadTtlDays()).toBe(14);
  });

  it("should fall back to the default for a non-numeric / non-positive value", () => {
    process.env["ADJUTANT_UPLOAD_TTL_DAYS"] = "nonsense";
    expect(resolveUploadTtlDays()).toBe(7);
    process.env["ADJUTANT_UPLOAD_TTL_DAYS"] = "0";
    expect(resolveUploadTtlDays()).toBe(7);
    process.env["ADJUTANT_UPLOAD_TTL_DAYS"] = "-3";
    expect(resolveUploadTtlDays()).toBe(7);
  });
});

describe("pruneOldUploads", () => {
  it("should delete files AND rows older than the TTL and report the count", () => {
    const old1 = seedAttachment(10);
    const old2 = seedAttachment(8);
    const recent = seedAttachment(1);

    const result = pruneOldUploads({ attachmentStore, storage, ttlDays: 7 });

    expect(result.prunedCount).toBe(2);
    // old rows gone
    expect(attachmentStore.getById(old1.id)).toBeNull();
    expect(attachmentStore.getById(old2.id)).toBeNull();
    // old files gone
    expect(existsSync(old1.storagePath)).toBe(false);
    expect(existsSync(old2.storagePath)).toBe(false);
    // recent kept
    expect(attachmentStore.getById(recent.id)).not.toBeNull();
    expect(existsSync(recent.storagePath)).toBe(true);
  });

  it("should keep everything when nothing is older than the TTL", () => {
    const r = seedAttachment(2);
    const result = pruneOldUploads({ attachmentStore, storage, ttlDays: 7 });
    expect(result.prunedCount).toBe(0);
    expect(attachmentStore.getById(r.id)).not.toBeNull();
    expect(existsSync(r.storagePath)).toBe(true);
  });

  it("should log the pruned count (no silent truncation)", () => {
    seedAttachment(30);
    seedAttachment(20);
    const spy = vi.spyOn(logger, "logInfo");
    const result = pruneOldUploads({ attachmentStore, storage, ttlDays: 7 });
    expect(result.prunedCount).toBe(2);
    const logged = spy.mock.calls.some(
      ([msg, meta]) => /prun/i.test(msg) && (meta as { prunedCount?: number } | undefined)?.prunedCount === 2,
    );
    expect(logged).toBe(true);
  });

  it("should still prune the row when the backing file is already gone", () => {
    const gone = seedAttachment(30);
    storage.delete(gone.storagePath); // file removed out-of-band
    expect(existsSync(gone.storagePath)).toBe(false);
    const result = pruneOldUploads({ attachmentStore, storage, ttlDays: 7 });
    expect(result.prunedCount).toBe(1);
    expect(attachmentStore.getById(gone.id)).toBeNull();
  });

  it("should default to the env/default TTL when ttlDays is omitted", () => {
    const old = seedAttachment(10);
    seedAttachment(1);
    // no ttlDays → resolveUploadTtlDays() → default 7
    const result = pruneOldUploads({ attachmentStore, storage });
    expect(result.prunedCount).toBe(1);
    expect(attachmentStore.getById(old.id)).toBeNull();
  });
});
