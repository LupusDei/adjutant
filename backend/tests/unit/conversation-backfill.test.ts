/**
 * Tests for the message → DM conversation backfill (adj-164.1.4).
 *
 * Rows are inserted through the real MessageStore (and a couple of raw legacy
 * rows with conversation_id NULL) so the backfill is exercised against the
 * actual `messages` schema and column shapes, never hand-crafted TS objects.
 *
 * Requirements under test:
 *  - existing messages group deterministically into DM conversations
 *    (one per agent↔user pair),
 *  - `thread_id` is reused as the conversation grouping where present,
 *  - the backfill is idempotent (safe to re-run, no duplicate conversations),
 *  - the backfill is reversible (an undo restores conversation_id to NULL and
 *    removes the conversations/members it created).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

import { runMigrations } from "../../src/services/database.js";
import { createMessageStore, type MessageStore } from "../../src/services/message-store.js";
import { backfillConversations, reverseBackfill } from "../../src/services/conversation-backfill.js";
import { dmConversationId } from "../../src/services/conversation-store.js";

let db: Database.Database;
let store: MessageStore;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  store = createMessageStore(db);
});

afterEach(() => {
  db.close();
});

function countConversations(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM conversations").get() as { c: number }).c;
}

function nullConversationIdCount(): number {
  return (
    db.prepare("SELECT COUNT(*) AS c FROM messages WHERE conversation_id IS NULL").get() as {
      c: number;
    }
  ).c;
}

describe("backfillConversations", () => {
  it("should create one DM conversation per agent↔user pair", () => {
    store.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "hi from raynor" });
    store.insertMessage({ agentId: "user", recipient: "raynor", role: "user", body: "hi raynor" });
    store.insertMessage({ agentId: "kerrigan", recipient: "user", role: "agent", body: "hi from kerrigan" });

    const result = backfillConversations(db);

    // Two distinct pairs: user↔raynor and user↔kerrigan.
    expect(result.conversationsCreated).toBe(2);
    expect(countConversations()).toBe(2);
    expect(nullConversationIdCount()).toBe(0);
  });

  it("should assign both directions of a pair to the SAME conversation", () => {
    const m1 = store.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "a" });
    const m2 = store.insertMessage({ agentId: "user", recipient: "raynor", role: "user", body: "b" });

    backfillConversations(db);

    const c1 = store.getMessage(m1.id)?.conversationId;
    const c2 = store.getMessage(m2.id)?.conversationId;
    expect(c1).toBeTruthy();
    expect(c1).toBe(c2);
  });

  // adj-hq8p4 (P2 DATA LOSS): threaded DM messages must be keyed on the
  // deterministic DM conversation id — NOT on thread_id. Live sends and the DM
  // view resolve on dmConversationId("user", agent); keying backfill on
  // thread_id stranded pre-existing threaded history in an orphan conversation
  // the DM view never queries, so it silently vanished. The thread_id is kept on
  // the message row for intra-conversation grouping, but it is not the
  // conversation id.
  it("should key threaded DM messages on the deterministic DM id, not thread_id", () => {
    const threaded1 = store.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "t1", threadId: "thread-xyz" });
    const threaded2 = store.insertMessage({ agentId: "user", recipient: "raynor", role: "user", body: "t2", threadId: "thread-xyz" });

    backfillConversations(db);

    const expectedDmId = dmConversationId("user", "raynor");
    const c1 = store.getMessage(threaded1.id)?.conversationId;
    const c2 = store.getMessage(threaded2.id)?.conversationId;
    expect(c1).toBe(expectedDmId);
    expect(c2).toBe(expectedDmId);

    // thread_id is preserved on the message row (intra-conversation grouping).
    expect(store.getMessage(threaded1.id)?.threadId).toBe("thread-xyz");

    // No orphan conversation was created keyed on the raw thread_id.
    const orphan = db.prepare("SELECT id FROM conversations WHERE id = ?").get("thread-xyz");
    expect(orphan).toBeUndefined();
  });

  it("should make backfilled threaded DM history reachable via the DM view (getMessages by conversationId)", () => {
    // Pre-existing threaded DM history (the exact shape that vanished).
    store.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "old threaded reply", threadId: "legacy-thread" });
    store.insertMessage({ agentId: "user", recipient: "raynor", role: "user", body: "old threaded question", threadId: "legacy-thread" });

    backfillConversations(db);

    // The DM view resolves on the deterministic pair id — backfilled history
    // must be visible there, not stranded under the thread id.
    const dmId = dmConversationId("user", "raynor");
    const visible = store.getMessages({ conversationId: dmId });
    const bodies = visible.map((m) => m.body);
    expect(bodies).toContain("old threaded reply");
    expect(bodies).toContain("old threaded question");

    // And nothing is reachable under the raw thread_id as a conversation id.
    const underThread = store.getMessages({ conversationId: "legacy-thread" });
    expect(underThread).toHaveLength(0);
  });

  it("should group threaded and non-threaded DMs for the same pair into ONE conversation", () => {
    // A threaded message and a plain message between the same pair must land in
    // the same DM conversation (both keyed on the deterministic pair id).
    const threaded = store.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "threaded", threadId: "t-1" });
    const plain = store.insertMessage({ agentId: "user", recipient: "raynor", role: "user", body: "plain" });

    backfillConversations(db);

    const expectedDmId = dmConversationId("user", "raynor");
    expect(store.getMessage(threaded.id)?.conversationId).toBe(expectedDmId);
    expect(store.getMessage(plain.id)?.conversationId).toBe(expectedDmId);
    // Exactly one conversation for the pair.
    expect(countConversations()).toBe(1);
  });

  it("should be idempotent — re-running creates no duplicate conversations", () => {
    store.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "a" });
    store.insertMessage({ agentId: "user", recipient: "raynor", role: "user", body: "b" });

    const first = backfillConversations(db);
    const before = countConversations();
    const second = backfillConversations(db);

    expect(countConversations()).toBe(before);
    expect(first.conversationsCreated).toBe(1);
    expect(second.conversationsCreated).toBe(0); // nothing left to backfill
    expect(second.messagesUpdated).toBe(0);
  });

  it("should skip messages that already have a conversation_id", () => {
    // Pre-scoped message (already migrated). Backfill must leave it untouched.
    store.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "scoped", conversationId: "pre-existing" });
    store.insertMessage({ agentId: "user", recipient: "kerrigan", role: "user", body: "needs-backfill" });

    const result = backfillConversations(db);

    // Only the kerrigan message needed backfilling.
    expect(result.messagesUpdated).toBe(1);
    const scoped = db.prepare("SELECT conversation_id FROM messages WHERE body = 'scoped'").get() as { conversation_id: string };
    expect(scoped.conversation_id).toBe("pre-existing");
  });

  it("should ignore non-DM messages (announcements/system with no clear pair)", () => {
    store.insertMessage({ agentId: "raynor", recipient: null as unknown as undefined, role: "announcement", body: "broadcast" });
    store.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "real dm" });

    const result = backfillConversations(db);

    // Only the real DM message is mapped; the announcement stays NULL.
    expect(result.messagesUpdated).toBe(1);
    const ann = db.prepare("SELECT conversation_id FROM messages WHERE body = 'broadcast'").get() as { conversation_id: string | null };
    expect(ann.conversation_id).toBeNull();
  });
});

describe("reverseBackfill", () => {
  it("should restore conversation_id to NULL and remove created conversations", () => {
    store.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "a" });
    store.insertMessage({ agentId: "user", recipient: "raynor", role: "user", body: "b" });

    backfillConversations(db);
    expect(countConversations()).toBe(1);
    expect(nullConversationIdCount()).toBe(0);

    reverseBackfill(db);

    expect(countConversations()).toBe(0);
    expect(nullConversationIdCount()).toBe(2);
  });

  it("should not touch conversations/messages that were pre-scoped before backfill", () => {
    // A conversation + message that existed independently of the backfill.
    db.prepare(
      "INSERT INTO conversations (id, kind, created_at, updated_at) VALUES ('manual-conv', 'channel', datetime('now'), datetime('now'))",
    ).run();
    store.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "scoped", conversationId: "manual-conv" });
    // A message that WILL be backfilled.
    store.insertMessage({ agentId: "user", recipient: "kerrigan", role: "user", body: "backfilled" });

    backfillConversations(db);
    reverseBackfill(db);

    // Manual conversation survives the reverse.
    expect(db.prepare("SELECT id FROM conversations WHERE id = 'manual-conv'").get()).toBeDefined();
    const scoped = db.prepare("SELECT conversation_id FROM messages WHERE body = 'scoped'").get() as { conversation_id: string };
    expect(scoped.conversation_id).toBe("manual-conv");
    // Backfilled message reverted to NULL.
    const reverted = db.prepare("SELECT conversation_id FROM messages WHERE body = 'backfilled'").get() as { conversation_id: string | null };
    expect(reverted.conversation_id).toBeNull();
  });
});
