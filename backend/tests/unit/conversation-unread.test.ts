/**
 * Tests for per-member conversation unread tracking (adj-164.4.5).
 *
 * Unread is computed per (conversation, member) from the member's last_read_at
 * watermark: messages created after that watermark, excluding the member's own
 * messages, are unread. A null watermark means the member has read nothing yet,
 * so all non-self messages are unread.
 *
 * markConversationRead advances the watermark; getUnreadCount /
 * getUnreadCountsForMember report against it.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

import { runMigrations } from "../../src/services/database.js";
import {
  createConversationStore,
  type ConversationStore,
} from "../../src/services/conversation-store.js";
import { createMessageStore, type MessageStore } from "../../src/services/message-store.js";

let db: Database.Database;
let store: ConversationStore;
let messageStore: MessageStore;

/**
 * Insert a message into a conversation with an explicit created_at so unread
 * watermark comparisons are deterministic (avoids same-second ties).
 */
function postAt(conversationId: string, senderId: string, body: string, createdAt: string): void {
  const role = senderId === "user" ? "user" : "agent";
  db.prepare(
    `INSERT INTO messages (id, agent_id, recipient, role, body, delivery_status, conversation_id, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, 'pending', ?, ?, ?)`,
  ).run(`m-${Math.random().toString(36).slice(2)}`, senderId, role, body, conversationId, createdAt, createdAt);
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  messageStore = createMessageStore(db);
  store = createConversationStore(db, messageStore);
});

afterEach(() => {
  db.close();
});

describe("ConversationStore.markConversationRead", () => {
  it("should set the member's last_read_at watermark", () => {
    const channel = store.createChannel({ title: "team", createdBy: "user" });
    store.markConversationRead(channel.id, "user", "2026-05-29T12:00:00Z");

    const member = store.getMembers(channel.id).find((m) => m.memberId === "user");
    expect(member?.lastReadAt).toBe("2026-05-29T12:00:00Z");
  });

  it("should default the watermark to now when no timestamp is given", () => {
    const channel = store.createChannel({ title: "team", createdBy: "user" });
    store.markConversationRead(channel.id, "user");
    const member = store.getMembers(channel.id).find((m) => m.memberId === "user");
    expect(member?.lastReadAt).toBeTruthy();
  });

  it("should be a no-op for a member not in the conversation", () => {
    const channel = store.createChannel({ title: "team", createdBy: "user" });
    expect(() => store.markConversationRead(channel.id, "ghost", "2026-05-29T12:00:00Z")).not.toThrow();
    const ghost = store.getMembers(channel.id).find((m) => m.memberId === "ghost");
    expect(ghost).toBeUndefined();
  });
});

describe("ConversationStore.getUnreadCount", () => {
  it("should count all non-self messages when the member has never read", () => {
    const channel = store.createChannel({ title: "team", createdBy: "user" });
    store.joinChannel(channel.id, { memberId: "raynor", memberKind: "agent" });

    postAt(channel.id, "raynor", "hello", "2026-05-29T10:00:00Z");
    postAt(channel.id, "raynor", "again", "2026-05-29T10:01:00Z");
    postAt(channel.id, "user", "my own message", "2026-05-29T10:02:00Z");

    // user has null watermark → two non-self messages are unread.
    expect(store.getUnreadCount(channel.id, "user")).toBe(2);
  });

  it("should count only messages newer than the watermark", () => {
    const channel = store.createChannel({ title: "team", createdBy: "user" });
    store.joinChannel(channel.id, { memberId: "raynor", memberKind: "agent" });

    postAt(channel.id, "raynor", "old", "2026-05-29T10:00:00Z");
    store.markConversationRead(channel.id, "user", "2026-05-29T10:30:00Z");
    postAt(channel.id, "raynor", "new1", "2026-05-29T11:00:00Z");
    postAt(channel.id, "raynor", "new2", "2026-05-29T11:01:00Z");

    expect(store.getUnreadCount(channel.id, "user")).toBe(2);
  });

  it("should never count the member's own messages as unread", () => {
    const channel = store.createChannel({ title: "team", createdBy: "user" });
    postAt(channel.id, "user", "self1", "2026-05-29T11:00:00Z");
    postAt(channel.id, "user", "self2", "2026-05-29T11:01:00Z");
    expect(store.getUnreadCount(channel.id, "user")).toBe(0);
  });

  it("should return 0 when everything is read", () => {
    const channel = store.createChannel({ title: "team", createdBy: "user" });
    store.joinChannel(channel.id, { memberId: "raynor", memberKind: "agent" });
    postAt(channel.id, "raynor", "msg", "2026-05-29T10:00:00Z");
    store.markConversationRead(channel.id, "user", "2026-05-29T23:59:59Z");
    expect(store.getUnreadCount(channel.id, "user")).toBe(0);
  });
});

describe("ConversationStore.getUnreadCountsForMember", () => {
  it("should report unread per conversation the member belongs to", () => {
    const c1 = store.createChannel({ title: "c1", createdBy: "user" });
    const c2 = store.createChannel({ title: "c2", createdBy: "user" });
    store.joinChannel(c1.id, { memberId: "raynor", memberKind: "agent" });
    store.joinChannel(c2.id, { memberId: "raynor", memberKind: "agent" });

    postAt(c1.id, "raynor", "a", "2026-05-29T10:00:00Z");
    postAt(c1.id, "raynor", "b", "2026-05-29T10:01:00Z");
    postAt(c2.id, "raynor", "c", "2026-05-29T10:02:00Z");

    const counts = store.getUnreadCountsForMember("user");
    const byId = Object.fromEntries(counts.map((u) => [u.conversationId, u.unreadCount]));
    expect(byId[c1.id]).toBe(2);
    expect(byId[c2.id]).toBe(1);
  });

  it("should not include conversations the member does not belong to", () => {
    const mine = store.createChannel({ title: "mine", createdBy: "user" });
    const theirs = store.createChannel({ title: "theirs", createdBy: "raynor" });
    postAt(theirs.id, "raynor", "secret", "2026-05-29T10:00:00Z");

    const counts = store.getUnreadCountsForMember("user");
    const ids = counts.map((u) => u.conversationId);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });

  it("should return an empty array for a member in no conversations", () => {
    store.createChannel({ title: "c1", createdBy: "raynor" });
    expect(store.getUnreadCountsForMember("nobody")).toEqual([]);
  });
});
