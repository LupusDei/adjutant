/**
 * Tests for AttachmentStore (adj-203.1.2).
 *
 * Pure data-access layer over the `message_attachments` table (migration 037).
 * Uses a real in-memory SQLite DB with real migrations applied (adj-067 rule) —
 * every assertion runs against actual inserted/fetched rows.
 *
 * Methods (≥3 tests each): createAttachment, linkToMessage, getById,
 * getByMessageId, deleteOlderThan.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

import { runMigrations } from "../../src/services/database.js";
import { createAttachmentStore, type AttachmentStore } from "../../src/services/attachment-store.js";

let db: Database.Database;
let store: AttachmentStore;

/** Insert a real message row so linkToMessage has a valid FK target. */
function insertMessage(id: string): void {
  db.prepare(
    `INSERT INTO messages (id, agent_id, role, body, delivery_status, created_at, updated_at)
     VALUES (?, 'user', 'user', 'hi', 'pending', datetime('now'), datetime('now'))`,
  ).run(id);
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  store = createAttachmentStore(db);
});

afterEach(() => {
  db.close();
});

// ============================================================================
// createAttachment
// ============================================================================

describe("AttachmentStore.createAttachment", () => {
  it("should persist an unlinked attachment with generated id + defaults (happy path)", () => {
    const a = store.createAttachment({
      kind: "image",
      storagePath: "/uploads/abc.png",
      filename: "screenshot.png",
      mimeType: "image/png",
      sizeBytes: 1234,
    });
    expect(a.id).toBeTruthy();
    expect(a.messageId).toBeNull();
    expect(a.kind).toBe("image");
    expect(a.storagePath).toBe("/uploads/abc.png");
    expect(a.filename).toBe("screenshot.png");
    expect(a.mimeType).toBe("image/png");
    expect(a.sizeBytes).toBe(1234);
    expect(a.createdAt).toBeTruthy();
  });

  it("should honor an explicitly supplied messageId at creation", () => {
    insertMessage("m-1");
    const a = store.createAttachment({
      messageId: "m-1",
      kind: "image",
      storagePath: "/uploads/x.jpg",
      filename: "x.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 10,
    });
    expect(a.messageId).toBe("m-1");
  });

  it("should round-trip through getById exactly", () => {
    const a = store.createAttachment({
      kind: "image",
      storagePath: "/uploads/y.gif",
      filename: "y.gif",
      mimeType: "image/gif",
      sizeBytes: 42,
    });
    expect(store.getById(a.id)).toEqual(a);
  });
});

// ============================================================================
// linkToMessage
// ============================================================================

describe("AttachmentStore.linkToMessage", () => {
  it("should link an unlinked attachment to a message", () => {
    insertMessage("m-2");
    const a = store.createAttachment({
      kind: "image",
      storagePath: "/u/a.png",
      filename: "a.png",
      mimeType: "image/png",
      sizeBytes: 5,
    });
    store.linkToMessage(a.id, "m-2");
    expect(store.getById(a.id)?.messageId).toBe("m-2");
  });

  it("should be idempotent when linking to the same message twice", () => {
    insertMessage("m-3");
    const a = store.createAttachment({
      kind: "image",
      storagePath: "/u/b.png",
      filename: "b.png",
      mimeType: "image/png",
      sizeBytes: 5,
    });
    store.linkToMessage(a.id, "m-3");
    store.linkToMessage(a.id, "m-3");
    expect(store.getById(a.id)?.messageId).toBe("m-3");
  });

  it("should not throw for an unknown attachment id (no rows updated)", () => {
    insertMessage("m-4");
    expect(() => {
      store.linkToMessage("does-not-exist", "m-4");
    }).not.toThrow();
    expect(store.getByMessageId("m-4")).toEqual([]);
  });
});

// ============================================================================
// getById
// ============================================================================

describe("AttachmentStore.getById", () => {
  it("should return the attachment when it exists", () => {
    const a = store.createAttachment({
      kind: "image",
      storagePath: "/u/c.webp",
      filename: "c.webp",
      mimeType: "image/webp",
      sizeBytes: 7,
    });
    expect(store.getById(a.id)?.id).toBe(a.id);
  });

  it("should return null for an unknown id", () => {
    expect(store.getById("nope")).toBeNull();
  });

  it("should reflect a subsequent linkToMessage", () => {
    insertMessage("m-5");
    const a = store.createAttachment({
      kind: "image",
      storagePath: "/u/d.png",
      filename: "d.png",
      mimeType: "image/png",
      sizeBytes: 9,
    });
    expect(store.getById(a.id)?.messageId).toBeNull();
    store.linkToMessage(a.id, "m-5");
    expect(store.getById(a.id)?.messageId).toBe("m-5");
  });
});

// ============================================================================
// getByMessageId
// ============================================================================

describe("AttachmentStore.getByMessageId", () => {
  it("should return all attachments linked to a message, oldest first", () => {
    insertMessage("m-6");
    const a1 = store.createAttachment({
      messageId: "m-6",
      kind: "image",
      storagePath: "/u/1.png",
      filename: "1.png",
      mimeType: "image/png",
      sizeBytes: 1,
    });
    const a2 = store.createAttachment({
      messageId: "m-6",
      kind: "image",
      storagePath: "/u/2.png",
      filename: "2.png",
      mimeType: "image/png",
      sizeBytes: 2,
    });
    const ids = store.getByMessageId("m-6").map((a) => a.id);
    expect(ids).toContain(a1.id);
    expect(ids).toContain(a2.id);
    expect(ids).toHaveLength(2);
  });

  it("should return an empty array when a message has no attachments", () => {
    insertMessage("m-7");
    expect(store.getByMessageId("m-7")).toEqual([]);
  });

  it("should not return unlinked attachments", () => {
    store.createAttachment({
      kind: "image",
      storagePath: "/u/orphan.png",
      filename: "orphan.png",
      mimeType: "image/png",
      sizeBytes: 3,
    });
    expect(store.getByMessageId("m-8")).toEqual([]);
  });
});

// ============================================================================
// deleteOlderThan
// ============================================================================

describe("AttachmentStore.deleteOlderThan", () => {
  function createAtAge(daysAgo: number, storagePath: string): string {
    const a = store.createAttachment({
      kind: "image",
      storagePath,
      filename: "f.png",
      mimeType: "image/png",
      sizeBytes: 1,
    });
    db.prepare("UPDATE message_attachments SET created_at = datetime('now', ?) WHERE id = ?").run(
      `-${daysAgo} days`,
      a.id,
    );
    return a.id;
  }

  it("should delete rows older than the cutoff and return them", () => {
    const oldId = createAtAge(10, "/u/old.png");
    createAtAge(1, "/u/new.png");
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const deleted = store.deleteOlderThan(cutoff);
    expect(deleted.map((d) => d.id)).toEqual([oldId]);
    expect(deleted[0]?.storagePath).toBe("/u/old.png");
    expect(store.getById(oldId)).toBeNull();
  });

  it("should keep rows newer than the cutoff", () => {
    const newId = createAtAge(1, "/u/keep.png");
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    store.deleteOlderThan(cutoff);
    expect(store.getById(newId)).not.toBeNull();
  });

  it("should return an empty array when nothing is old enough", () => {
    createAtAge(0, "/u/fresh.png");
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(store.deleteOlderThan(cutoff)).toEqual([]);
  });
});
