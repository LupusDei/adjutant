/**
 * Tests for attachment linking on message send (adj-203.2.3).
 *
 * Two layers:
 *  - MessageStore (with an injected AttachmentStore): insertMessage({attachmentIds})
 *    links the unlinked attachment rows to the new message, and reads (insert return,
 *    getMessage, getMessages) HYDRATE `attachments`. Omitted/empty → a plain message.
 *  - POST /api/messages: accepts optional `attachmentIds`, links them, and the
 *    persisted message carries its attachments.
 *
 * Real in-memory SQLite + real stores (adj-067 rule).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import Database from "better-sqlite3";

import { runMigrations } from "../../src/services/database.js";
import { createAttachmentStore, type AttachmentStore } from "../../src/services/attachment-store.js";
import { createMessageStore, type MessageStore } from "../../src/services/message-store.js";
import { createMessagesRouter } from "../../src/routes/messages.js";

let db: Database.Database;
let attachmentStore: AttachmentStore;
let store: MessageStore;

function makeAttachment(): string {
  return attachmentStore.createAttachment({
    kind: "image",
    storagePath: `/uploads/${Math.random().toString(36).slice(2)}.png`,
    filename: "shot.png",
    mimeType: "image/png",
    sizeBytes: 100,
  }).id;
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  attachmentStore = createAttachmentStore(db);
  store = createMessageStore(db, { attachmentStore });
});

afterEach(() => {
  db.close();
});

// ============================================================================
// MessageStore linking + hydration
// ============================================================================

describe("MessageStore.insertMessage with attachmentIds", () => {
  it("should link the attachments and hydrate them on the returned message", () => {
    const a1 = makeAttachment();
    const a2 = makeAttachment();
    const msg = store.insertMessage({
      agentId: "user",
      recipient: "raynor",
      role: "user",
      body: "look at this",
      attachmentIds: [a1, a2],
    });
    expect(msg.attachments).toBeDefined();
    expect(msg.attachments!.map((a) => a.id).sort()).toEqual([a1, a2].sort());
    // rows are now linked to this message
    expect(attachmentStore.getById(a1)?.messageId).toBe(msg.id);
    expect(attachmentStore.getById(a2)?.messageId).toBe(msg.id);
  });

  it("should produce a plain message (no attachments) when attachmentIds is omitted", () => {
    const msg = store.insertMessage({ agentId: "user", recipient: "raynor", role: "user", body: "hi" });
    expect(msg.attachments ?? []).toEqual([]);
  });

  it("should produce a plain message when attachmentIds is empty", () => {
    const msg = store.insertMessage({
      agentId: "user",
      recipient: "raynor",
      role: "user",
      body: "hi",
      attachmentIds: [],
    });
    expect(msg.attachments ?? []).toEqual([]);
  });

  it("should hydrate attachments on getMessage and getMessages after linking", () => {
    const a1 = makeAttachment();
    const msg = store.insertMessage({
      agentId: "user",
      recipient: "raynor",
      role: "user",
      body: "with img",
      attachmentIds: [a1],
    });
    expect(store.getMessage(msg.id)?.attachments?.[0]?.id).toBe(a1);
    const list = store.getMessages({ agentId: "raynor" });
    const found = list.find((m) => m.id === msg.id);
    expect(found?.attachments?.[0]?.id).toBe(a1);
  });
});

// ============================================================================
// POST /api/messages with attachmentIds
// ============================================================================

describe("POST /api/messages with attachmentIds", () => {
  let app: express.Express;
  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use("/api/messages", createMessagesRouter(store));
  });

  it("should link supplied attachmentIds to the created message", async () => {
    const a1 = makeAttachment();
    const res = await request(app)
      .post("/api/messages")
      .send({ to: "raynor", body: "screenshot attached", attachmentIds: [a1] });
    expect(res.status).toBe(201);
    const messageId = res.body.data.messageId as string;
    expect(attachmentStore.getById(a1)?.messageId).toBe(messageId);
    expect(store.getMessage(messageId)?.attachments?.[0]?.id).toBe(a1);
  });

  it("should still send a plain message when attachmentIds is omitted", async () => {
    const res = await request(app).post("/api/messages").send({ to: "raynor", body: "plain" });
    expect(res.status).toBe(201);
    const messageId = res.body.data.messageId as string;
    expect(store.getMessage(messageId)?.attachments ?? []).toEqual([]);
  });

  it("should reject more than 4 attachments (per-message cap)", async () => {
    const ids = [makeAttachment(), makeAttachment(), makeAttachment(), makeAttachment(), makeAttachment()];
    const res = await request(app).post("/api/messages").send({ to: "raynor", body: "too many", attachmentIds: ids });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("should accept an image-only DM (empty body + ≥1 attachment) and persist/link it (adj-203.2.5.2)", async () => {
    const a1 = makeAttachment();
    const res = await request(app)
      .post("/api/messages")
      .send({ to: "raynor", body: "", attachmentIds: [a1] });
    expect(res.status).toBe(201);
    const messageId = res.body.data.messageId as string;
    expect(attachmentStore.getById(a1)?.messageId).toBe(messageId);
    expect(store.getMessage(messageId)?.attachments?.[0]?.id).toBe(a1);
  });

  it("should accept an image-only DM when body is omitted entirely (adj-203.2.5.2)", async () => {
    const a1 = makeAttachment();
    const res = await request(app).post("/api/messages").send({ to: "raynor", attachmentIds: [a1] });
    expect(res.status).toBe(201);
    expect(attachmentStore.getById(a1)?.messageId).toBe(res.body.data.messageId);
  });

  it("should still reject an empty body with NO attachments (adj-203.2.5.2)", async () => {
    const res = await request(app).post("/api/messages").send({ to: "raynor", body: "" });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("should still reject a whitespace-only body with NO attachments (adj-203.2.5.2)", async () => {
    const res = await request(app).post("/api/messages").send({ to: "raynor", body: "   " });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("should still reject a message with neither body nor attachments (adj-203.2.5.2)", async () => {
    const res = await request(app).post("/api/messages").send({ to: "raynor" });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("should NOT leak the absolute storagePath in GET /api/messages (adj-203.2.5.1)", async () => {
    const a1 = makeAttachment();
    await request(app).post("/api/messages").send({ to: "raynor", body: "shot", attachmentIds: [a1] });

    const list = await request(app).get("/api/messages").query({ agentId: "raynor" });
    expect(list.status).toBe(200);
    const items = list.body.data.items as { attachments?: unknown[] }[];
    const withAttachment = items.find((m) => Array.isArray(m.attachments) && m.attachments.length > 0);
    expect(withAttachment).toBeDefined();
    const att = (withAttachment!.attachments as Record<string, unknown>[])[0]!;
    // Public shape only.
    expect(att).toHaveProperty("id");
    expect(att).toHaveProperty("filename");
    expect(att).toHaveProperty("mimeType");
    expect(att).toHaveProperty("sizeBytes");
    expect(att).not.toHaveProperty("storagePath");
    expect(JSON.stringify(list.body)).not.toContain("/uploads/");
  });
});
