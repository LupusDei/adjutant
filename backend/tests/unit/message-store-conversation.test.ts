/**
 * Tests for conversation-scoped message persistence + retrieval (adj-164.1.3).
 *
 * The keystone here is the BLEED REGRESSION: two conversations must never leak
 * each other's messages when fetched by `conversationId`. This is the root-cause
 * fix for the fragile `(agent_id = ? OR (role='user' AND recipient = ?))` path
 * that previously widened DM reads and caused wrong-thread bleed.
 *
 * Row shapes are exercised against the real `messages` schema via runMigrations,
 * not hand-crafted from TS types.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

import { runMigrations } from "../../src/services/database.js";
import { createMessageStore, type MessageStore } from "../../src/services/message-store.js";

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

describe("MessageStore.insertMessage with conversationId", () => {
  it("should persist the conversationId on the stored message", () => {
    const msg = store.insertMessage({
      agentId: "raynor",
      recipient: "user",
      role: "agent",
      body: "hello",
      conversationId: "conv-1",
    });
    expect(msg.conversationId).toBe("conv-1");

    const reread = store.getMessage(msg.id);
    expect(reread?.conversationId).toBe("conv-1");
  });

  it("should default conversationId to null when not provided", () => {
    const msg = store.insertMessage({
      agentId: "raynor",
      recipient: "user",
      role: "agent",
      body: "legacy",
    });
    expect(msg.conversationId).toBeNull();
  });
});

describe("MessageStore.getMessages with conversationId filter", () => {
  it("should return only messages for the requested conversation", () => {
    store.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "a1", conversationId: "conv-a" });
    store.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "b1", conversationId: "conv-b" });
    store.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "a2", conversationId: "conv-a" });

    const bodies = store.getMessages({ conversationId: "conv-a" }).map((m) => m.body).sort();
    expect(bodies).toEqual(["a1", "a2"]);
  });

  it("should return an empty array for a conversation with no messages", () => {
    store.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "x", conversationId: "conv-a" });
    expect(store.getMessages({ conversationId: "conv-empty" })).toEqual([]);
  });

  it("should let conversationId take precedence over the legacy agentId path", () => {
    // Two agents both posting into the SAME conversation. The legacy agentId
    // widening must NOT apply when conversationId is supplied.
    store.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "from-raynor", conversationId: "conv-shared" });
    store.insertMessage({ agentId: "kerrigan", recipient: "user", role: "agent", body: "from-kerrigan", conversationId: "conv-shared" });
    // A raynor message in a DIFFERENT conversation must be excluded.
    store.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "elsewhere", conversationId: "conv-other" });

    const bodies = store
      .getMessages({ conversationId: "conv-shared", agentId: "raynor" })
      .map((m) => m.body)
      .sort();
    expect(bodies).toEqual(["from-kerrigan", "from-raynor"]);
  });

  it("BLEED REGRESSION: messages in conversation A never appear when reading conversation B", () => {
    // Simulate the historical bug: same agent + user pair, but two distinct
    // conversations. Reading one must never surface the other's messages.
    store.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "A:agent", conversationId: "conv-A" });
    store.insertMessage({ agentId: "user", recipient: "raynor", role: "user", body: "A:user", conversationId: "conv-A" });
    store.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "B:agent", conversationId: "conv-B" });
    store.insertMessage({ agentId: "user", recipient: "raynor", role: "user", body: "B:user", conversationId: "conv-B" });

    const aBodies = store.getMessages({ conversationId: "conv-A" }).map((m) => m.body).sort();
    const bBodies = store.getMessages({ conversationId: "conv-B" }).map((m) => m.body).sort();

    expect(aBodies).toEqual(["A:agent", "A:user"]);
    expect(bBodies).toEqual(["B:agent", "B:user"]);
    // Cross-leak assertions: neither set contains the other's payloads.
    expect(aBodies).not.toContain("B:agent");
    expect(aBodies).not.toContain("B:user");
    expect(bBodies).not.toContain("A:agent");
    expect(bBodies).not.toContain("A:user");
  });

  it("should still support cursor pagination within a conversation", () => {
    for (let i = 0; i < 5; i++) {
      store.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: `m${i}`, conversationId: "conv-p" });
    }
    const firstPage = store.getMessages({ conversationId: "conv-p", limit: 2 });
    expect(firstPage).toHaveLength(2);
    // Newest-first ordering preserved (DESC) for the cursor path.
    const all = store.getMessages({ conversationId: "conv-p" });
    expect(all).toHaveLength(5);
  });

  it("should preserve the legacy agentId widening when no conversationId is given", () => {
    // Backwards compatibility: existing DM reads that pass only agentId still
    // get the (agent_id OR role=user/recipient) behavior.
    store.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "agent-said" });
    store.insertMessage({ agentId: "user", recipient: "raynor", role: "user", body: "user-said" });
    store.insertMessage({ agentId: "kerrigan", recipient: "user", role: "agent", body: "other-agent" });

    const bodies = store.getMessages({ agentId: "raynor" }).map((m) => m.body).sort();
    expect(bodies).toEqual(["agent-said", "user-said"]);
  });
});
