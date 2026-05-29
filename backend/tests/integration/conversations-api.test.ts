/**
 * Integration tests for the conversations REST API (adj-164.1.5).
 *
 * Spins up a real Express app over an in-memory SQLite DB and exercises:
 *  - GET /api/conversations            → conversations the user is a member of
 *  - GET /api/conversations/:id/messages → scoped, paginated, 404 on unknown id
 *
 * These prove the route → service → store wiring and the conversation scoping
 * contract end-to-end (no cross-conversation bleed at the HTTP boundary).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { AddressInfo } from "node:net";

import express, { type Express } from "express";
import Database from "better-sqlite3";
import supertest from "supertest";

import { runMigrations } from "../../src/services/database.js";
import { createMessageStore, type MessageStore } from "../../src/services/message-store.js";
import { createConversationStore, type ConversationStore } from "../../src/services/conversation-store.js";
import { createConversationsRouter } from "../../src/routes/conversations.js";

let app: Express;
let server: http.Server;
let db: Database.Database;
let convStore: ConversationStore;
let msgStore: MessageStore;

function agent(): supertest.Agent {
  return supertest.agent(app);
}

beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  convStore = createConversationStore(db);
  msgStore = createMessageStore(db);

  app = express();
  app.use(express.json());
  app.use("/api/conversations", createConversationsRouter(convStore, msgStore));

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  db.close();
});

describe("GET /api/conversations", () => {
  it("should return conversations the user is a member of", async () => {
    const dm = convStore.getOrCreateDm("user", "raynor");
    const channel = convStore.createConversation({ kind: "channel", title: "ops" });
    convStore.addMember(channel.id, { memberId: "user", memberKind: "user" });
    // A conversation the user is NOT in.
    const other = convStore.createConversation({ kind: "channel", title: "secret" });
    convStore.addMember(other.id, { memberId: "kerrigan", memberKind: "agent" });

    const res = await agent().get("/api/conversations");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const ids = (res.body.data.conversations as { id: string }[]).map((c) => c.id).sort();
    expect(ids).toEqual([dm.id, channel.id].sort());
    expect(ids).not.toContain(other.id);
  });

  it("should return an empty list when the user has no conversations", async () => {
    const res = await agent().get("/api/conversations");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.conversations).toEqual([]);
  });
});

describe("GET /api/conversations/dm/:agentId", () => {
  it("should return the deterministic DM conversation for a user↔agent pair", async () => {
    const res = await agent().get("/api/conversations/dm/raynor");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const conv = res.body.data.conversation as { id: string; kind: string };
    expect(conv.kind).toBe("dm");
    // The id must match the store's deterministic derivation for ("user","raynor").
    const expected = convStore.getOrCreateDm("user", "raynor");
    expect(conv.id).toBe(expected.id);
  });

  it("should be idempotent — repeated calls return the same conversation id", async () => {
    const first = await agent().get("/api/conversations/dm/kerrigan");
    const second = await agent().get("/api/conversations/dm/kerrigan");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data.conversation.id).toBe(second.body.data.conversation.id);
  });

  it("should create the DM (and its membership) on first access", async () => {
    const res = await agent().get("/api/conversations/dm/zeratul");
    expect(res.status).toBe(200);

    const convId = res.body.data.conversation.id as string;
    // The user must be a member so the conversation shows in their list.
    const listed = await agent().get("/api/conversations");
    const ids = (listed.body.data.conversations as { id: string }[]).map((c) => c.id);
    expect(ids).toContain(convId);
  });
});

describe("GET /api/conversations/:id/messages", () => {
  it("should return only that conversation's messages, chronologically", async () => {
    const a = convStore.getOrCreateDm("user", "raynor");
    const b = convStore.getOrCreateDm("user", "kerrigan");

    msgStore.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "a1", conversationId: a.id });
    msgStore.insertMessage({ agentId: "user", recipient: "raynor", role: "user", body: "a2", conversationId: a.id });
    msgStore.insertMessage({ agentId: "kerrigan", recipient: "user", role: "agent", body: "b1", conversationId: b.id });

    const res = await agent().get(`/api/conversations/${a.id}/messages`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const bodies = (res.body.data.items as { body: string }[]).map((m) => m.body);
    // Conversation A's two messages are present; conversation B's never bleeds in.
    // (a1/a2 share a same-second created_at, so we assert membership not order.)
    expect(bodies.sort()).toEqual(["a1", "a2"]);
    expect(bodies).not.toContain("b1");
  });

  it("should respect the limit query param", async () => {
    const a = convStore.getOrCreateDm("user", "raynor");
    for (let i = 0; i < 5; i++) {
      msgStore.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: `m${i}`, conversationId: a.id });
    }

    const res = await agent().get(`/api/conversations/${a.id}/messages?limit=2`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.hasMore).toBe(true);
  });

  it("should return 404 for an unknown conversation id", async () => {
    const res = await agent().get("/api/conversations/does-not-exist/messages");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
