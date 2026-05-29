/**
 * Integration tests for the channels REST API (adj-164.4.4).
 *
 * Spins up a real Express app over an in-memory SQLite DB and exercises:
 *  - POST   /api/channels                 → create a channel
 *  - GET    /api/channels                 → list channels (with member counts)
 *  - POST   /api/channels/:id/join        → add a member
 *  - POST   /api/channels/:id/leave       → remove a member
 *  - POST   /api/channels/:id/messages    → post a message (room-scoped fan-out)
 *
 * Proves the route → service → store wiring plus membership enforcement at the
 * HTTP boundary. WS fan-out is mocked to keep this an HTTP-layer test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import express, { type Express } from "express";
import Database from "better-sqlite3";
import supertest from "supertest";

import { runMigrations } from "../../src/services/database.js";
import { createMessageStore, type MessageStore } from "../../src/services/message-store.js";
import {
  createConversationStore,
  type ConversationStore,
} from "../../src/services/conversation-store.js";
import { createChannelsRouter } from "../../src/routes/channels.js";

// Mock the room-scoped broadcast so the post endpoint can be asserted without a
// live WebSocket server. `vi.mock` is hoisted above the imports by vitest.
const mockWsBroadcastToConversation = vi.fn();
vi.mock("../../src/services/ws-server.js", () => ({
  wsBroadcastToConversation: (...args: unknown[]) => mockWsBroadcastToConversation(...args),
}));

let app: Express;
let db: Database.Database;
let convStore: ConversationStore;
let msgStore: MessageStore;

function api(): supertest.Agent {
  return supertest.agent(app);
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  msgStore = createMessageStore(db);
  convStore = createConversationStore(db, msgStore);
  vi.clearAllMocks();

  app = express();
  app.use(express.json());
  app.use("/api/channels", createChannelsRouter(convStore));
});

afterEach(() => {
  db.close();
});

describe("POST /api/channels", () => {
  it("should create a channel and return its id and title", async () => {
    const res = await api().post("/api/channels").send({ title: "ops" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.title).toBe("ops");

    // The creator (defaulting to "user") is an owner member.
    const members = convStore.getMembers(res.body.data.id);
    expect(members.find((m) => m.memberId === "user")?.role).toBe("owner");
  });

  it("should return 400 when title is missing", async () => {
    const res = await api().post("/api/channels").send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("should return 400 when title is blank", async () => {
    const res = await api().post("/api/channels").send({ title: "   " });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe("GET /api/channels", () => {
  it("should list channels with member counts", async () => {
    const channel = convStore.createChannel({ title: "alpha", createdBy: "user" });
    convStore.joinChannel(channel.id, { memberId: "raynor", memberKind: "agent" });

    const res = await api().get("/api/channels");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.channels).toHaveLength(1);
    expect(res.body.data.channels[0].title).toBe("alpha");
    expect(res.body.data.channels[0].memberCount).toBe(2);
  });

  it("should return an empty list when there are no channels", async () => {
    const res = await api().get("/api/channels");
    expect(res.status).toBe(200);
    expect(res.body.data.channels).toEqual([]);
  });
});

describe("POST /api/channels/:id/join", () => {
  it("should add a member to a channel", async () => {
    const channel = convStore.createChannel({ title: "team", createdBy: "user" });

    const res = await api()
      .post(`/api/channels/${channel.id}/join`)
      .send({ memberId: "raynor", memberKind: "agent" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(convStore.getMembers(channel.id).map((m) => m.memberId)).toContain("raynor");
  });

  it("should return 404 when the channel does not exist", async () => {
    const res = await api()
      .post("/api/channels/nope/join")
      .send({ memberId: "raynor", memberKind: "agent" });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("should return 400 when memberId is missing", async () => {
    const channel = convStore.createChannel({ title: "team", createdBy: "user" });
    const res = await api().post(`/api/channels/${channel.id}/join`).send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe("POST /api/channels/:id/leave", () => {
  it("should remove a member from a channel", async () => {
    const channel = convStore.createChannel({ title: "team", createdBy: "user" });
    convStore.joinChannel(channel.id, { memberId: "raynor", memberKind: "agent" });

    const res = await api()
      .post(`/api/channels/${channel.id}/leave`)
      .send({ memberId: "raynor" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(convStore.getMembers(channel.id).map((m) => m.memberId)).not.toContain("raynor");
  });

  it("should return 404 when the channel does not exist", async () => {
    const res = await api().post("/api/channels/nope/leave").send({ memberId: "raynor" });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe("POST /api/channels/:id/messages", () => {
  it("should persist a member's message and fan it out room-scoped", async () => {
    const channel = convStore.createChannel({ title: "team", createdBy: "user" });

    const res = await api()
      .post(`/api/channels/${channel.id}/messages`)
      .send({ body: "status?", senderId: "user" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.messageId).toBeTruthy();

    const scoped = msgStore.getMessages({ conversationId: channel.id });
    expect(scoped.some((m) => m.body === "status?")).toBe(true);

    expect(mockWsBroadcastToConversation).toHaveBeenCalledTimes(1);
    expect(mockWsBroadcastToConversation.mock.calls[0][0]).toBe(channel.id);
  });

  it("should default the sender to 'user' when senderId is omitted", async () => {
    const channel = convStore.createChannel({ title: "team", createdBy: "user" });

    const res = await api().post(`/api/channels/${channel.id}/messages`).send({ body: "hi" });

    expect(res.status).toBe(201);
    const scoped = msgStore.getMessages({ conversationId: channel.id });
    expect(scoped[0]?.agentId).toBe("user");
  });

  it("should return 400 when body is missing", async () => {
    const channel = convStore.createChannel({ title: "team", createdBy: "user" });
    const res = await api().post(`/api/channels/${channel.id}/messages`).send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockWsBroadcastToConversation).not.toHaveBeenCalled();
  });

  it("should return 403 when the sender is not a member", async () => {
    const channel = convStore.createChannel({ title: "team", createdBy: "user" });

    const res = await api()
      .post(`/api/channels/${channel.id}/messages`)
      .send({ body: "intrude", senderId: "intruder" });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(mockWsBroadcastToConversation).not.toHaveBeenCalled();
  });

  it("should return 404 when the channel does not exist", async () => {
    const res = await api()
      .post("/api/channels/nope/messages")
      .send({ body: "hi", senderId: "user" });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
