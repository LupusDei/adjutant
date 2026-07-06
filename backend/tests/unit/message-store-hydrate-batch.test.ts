/**
 * Tests for batched attachment hydration on the chat-history hot path (adj-203.2.6).
 *
 * MessageStore.getMessages previously hydrated attachments with one
 * attachmentStore.getByMessageId call PER message (N+1). This asserts the list
 * path now fetches attachments for N messages in O(1) attachment queries via a
 * single batched getByMessageIds call — while still returning correct per-message
 * attachments. Real in-memory SQLite + real stores (adj-067 rule).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";

import { runMigrations } from "../../src/services/database.js";
import { createAttachmentStore, type AttachmentStore } from "../../src/services/attachment-store.js";
import { createMessageStore } from "../../src/services/message-store.js";

let db: Database.Database;
let attachmentStore: AttachmentStore;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  attachmentStore = createAttachmentStore(db);
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe("MessageStore.getMessages batched hydration (adj-203.2.6)", () => {
  it("should hydrate N messages' attachments in O(1) attachment queries", () => {
    const store = createMessageStore(db, { attachmentStore });

    // 5 messages in the same conversation, each with one attachment.
    for (let i = 0; i < 5; i++) {
      const att = attachmentStore.createAttachment({
        kind: "image",
        storagePath: `/u/${i}.png`,
        filename: `${i}.png`,
        mimeType: "image/png",
        sizeBytes: i + 1,
      });
      store.insertMessage({
        agentId: "user",
        recipient: "raynor",
        role: "user",
        body: `m${i}`,
        conversationId: "conv-1",
        attachmentIds: [att.id],
      });
    }

    const perMessageSpy = vi.spyOn(attachmentStore, "getByMessageId");
    const batchSpy = vi.spyOn(attachmentStore, "getByMessageIds");

    const messages = store.getMessages({ conversationId: "conv-1" });

    expect(messages).toHaveLength(5);
    // O(1): a single batched attachment fetch, NOT one per message.
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(perMessageSpy).not.toHaveBeenCalled();
  });

  it("should still attach the correct attachments to each message", () => {
    const store = createMessageStore(db, { attachmentStore });
    const attA = attachmentStore.createAttachment({
      kind: "image",
      storagePath: "/u/a.png",
      filename: "a.png",
      mimeType: "image/png",
      sizeBytes: 1,
    });
    const msgWith = store.insertMessage({
      agentId: "user",
      recipient: "raynor",
      role: "user",
      body: "with",
      conversationId: "conv-2",
      attachmentIds: [attA.id],
    });
    store.insertMessage({
      agentId: "user",
      recipient: "raynor",
      role: "user",
      body: "without",
      conversationId: "conv-2",
    });

    const messages = store.getMessages({ conversationId: "conv-2" });
    const withMsg = messages.find((m) => m.id === msgWith.id);
    const withoutMsg = messages.find((m) => m.body === "without");
    expect(withMsg?.attachments?.map((a) => a.id)).toEqual([attA.id]);
    expect(withoutMsg?.attachments).toEqual([]);
  });

  it("should make one batched call even when NO messages have attachments", () => {
    const store = createMessageStore(db, { attachmentStore });
    store.insertMessage({ agentId: "user", recipient: "raynor", role: "user", body: "plain", conversationId: "c3" });
    const batchSpy = vi.spyOn(attachmentStore, "getByMessageIds");
    const messages = store.getMessages({ conversationId: "c3" });
    expect(messages[0]?.attachments).toEqual([]);
    // At most one batched query (or zero when the id list is empty) — never N.
    expect(batchSpy.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
