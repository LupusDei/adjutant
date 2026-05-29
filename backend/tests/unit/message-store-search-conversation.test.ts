/**
 * Tests for conversation-scoped FTS search (adj-164.7.1 / T029).
 *
 * `searchMessages` must accept a `conversationId` filter that restricts FTS
 * matches to a single conversation. This is the search counterpart to the
 * conversation-scoping bleed fix: a search inside conversation A must never
 * surface a hit that lives in conversation B, even when both contain the query
 * term and involve the same agent/user pair.
 *
 * Row shapes are exercised against the real `messages` + `messages_fts` schema
 * via runMigrations, not hand-crafted from TS types (Constitution Rule 1).
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

describe("MessageStore.searchMessages with conversationId filter", () => {
  it("should return only matching messages within the requested conversation", () => {
    store.insertMessage({
      agentId: "raynor",
      recipient: "user",
      role: "agent",
      body: "deploy the rollout pipeline",
      conversationId: "conv-a",
    });
    store.insertMessage({
      agentId: "raynor",
      recipient: "user",
      role: "agent",
      body: "rollout is blocked elsewhere",
      conversationId: "conv-b",
    });

    const bodies = store
      .searchMessages("rollout", { conversationId: "conv-a" })
      .map((m) => m.body);

    expect(bodies).toEqual(["deploy the rollout pipeline"]);
  });

  it("should return an empty array when the term matches only another conversation", () => {
    store.insertMessage({
      agentId: "raynor",
      recipient: "user",
      role: "agent",
      body: "the migration succeeded",
      conversationId: "conv-b",
    });

    const results = store.searchMessages("migration", { conversationId: "conv-a" });
    expect(results).toEqual([]);
  });

  it("BLEED REGRESSION: a hit in conversation B never leaks into a conversation-A search", () => {
    // Same agent+user pair, same query term, two distinct conversations.
    store.insertMessage({
      agentId: "raynor",
      recipient: "user",
      role: "agent",
      body: "secret token in A",
      conversationId: "conv-A",
    });
    store.insertMessage({
      agentId: "user",
      recipient: "raynor",
      role: "user",
      body: "secret token in B",
      conversationId: "conv-B",
    });

    const aHits = store.searchMessages("secret", { conversationId: "conv-A" }).map((m) => m.body);
    const bHits = store.searchMessages("secret", { conversationId: "conv-B" }).map((m) => m.body);

    expect(aHits).toEqual(["secret token in A"]);
    expect(bHits).toEqual(["secret token in B"]);
    expect(aHits).not.toContain("secret token in B");
    expect(bHits).not.toContain("secret token in A");
  });

  it("should let conversationId scope cut across multiple agents in one channel", () => {
    // Channel-style conversation with two agents both matching the term; a
    // matching message in a different conversation must be excluded.
    store.insertMessage({ agentId: "raynor", role: "agent", body: "build report ready", conversationId: "chan-1" });
    store.insertMessage({ agentId: "kerrigan", role: "agent", body: "report attached", conversationId: "chan-1" });
    store.insertMessage({ agentId: "raynor", role: "agent", body: "report elsewhere", conversationId: "chan-2" });

    const bodies = store
      .searchMessages("report", { conversationId: "chan-1" })
      .map((m) => m.body)
      .sort();

    expect(bodies).toEqual(["build report ready", "report attached"]);
  });

  it("should still honor the agentId filter when no conversationId is supplied", () => {
    // Backwards compatibility: existing agent-scoped search is unchanged.
    store.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "raynor status update" });
    store.insertMessage({ agentId: "kerrigan", recipient: "user", role: "agent", body: "kerrigan status update" });

    const bodies = store.searchMessages("status", { agentId: "raynor" }).map((m) => m.body);
    expect(bodies).toEqual(["raynor status update"]);
  });

  it("should respect the limit within a conversation scope", () => {
    for (let i = 0; i < 5; i++) {
      store.insertMessage({
        agentId: "raynor",
        role: "agent",
        body: `report number ${i}`,
        conversationId: "conv-lim",
      });
    }
    const results = store.searchMessages("report", { conversationId: "conv-lim", limit: 2 });
    expect(results).toHaveLength(2);
  });

  it("should return empty for a blank query even with a conversationId", () => {
    store.insertMessage({ agentId: "raynor", role: "agent", body: "anything", conversationId: "conv-a" });
    expect(store.searchMessages("   ", { conversationId: "conv-a" })).toEqual([]);
  });
});
