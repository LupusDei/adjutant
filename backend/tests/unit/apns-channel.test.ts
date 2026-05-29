/**
 * adj-164.7.3 — channel-post APNS notifications.
 *
 * A channel post notifies the dashboard operator ("user") when they are a
 * member and NOT the sender. The operator's own posts never notify them, and
 * view-time suppression is handled client-side (iOS NotificationService).
 *
 * apns-service + ws-server are mocked so we assert the trigger without sockets.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import express, { type Express } from "express";
import Database from "better-sqlite3";
import supertest from "supertest";

import { runMigrations } from "../../src/services/database.js";
import { createMessageStore, type MessageStore } from "../../src/services/message-store.js";
import { createConversationStore, type ConversationStore } from "../../src/services/conversation-store.js";
import { createChannelsRouter } from "../../src/routes/channels.js";

vi.mock("../../src/services/ws-server.js", () => ({
  wsBroadcastToConversation: vi.fn(),
}));

const mockSendToAll = vi.fn().mockResolvedValue({ success: true, data: { sent: 1, failed: 0, results: [] } });
const mockConfigured = vi.fn().mockReturnValue(true);
vi.mock("../../src/services/apns-service.js", () => ({
  isAPNsConfigured: () => mockConfigured(),
  sendNotificationToAll: (...args: unknown[]) => mockSendToAll(...args),
}));

let app: Express;
let server: http.Server;
let db: Database.Database;
let convStore: ConversationStore;
let msgStore: MessageStore;

function api(): supertest.Agent {
  return supertest.agent(app);
}

async function makeChannel(): Promise<string> {
  const id = (await api().post("/api/channels").send({ title: "ops" })).body.data.id as string;
  await api().post(`/api/channels/${id}/join`).send({ memberId: "raynor", memberKind: "agent" });
  return id;
}

beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  msgStore = createMessageStore(db);
  convStore = createConversationStore(db, msgStore);
  vi.clearAllMocks();
  mockConfigured.mockReturnValue(true);

  app = express();
  app.use(express.json());
  app.use("/api/channels", createChannelsRouter(convStore));
  await new Promise<void>((resolve) => { server = app.listen(0, () => { resolve(); }); });
});

afterEach(async () => {
  await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
  db.close();
});

describe("channel-post APNS (adj-164.7.3)", () => {
  it("notifies the operator when an agent member posts to a channel they belong to", async () => {
    const channelId = await makeChannel();

    const res = await api().post(`/api/channels/${channelId}/messages`).send({ body: "rally point set", senderId: "raynor" });
    expect(res.status).toBe(201);

    expect(mockSendToAll).toHaveBeenCalledTimes(1);
    const payload = mockSendToAll.mock.calls[0][0] as { category: string; threadId: string; data: Record<string, unknown> };
    expect(payload.category).toBe("CHANNEL_MESSAGE");
    expect(payload.threadId).toBe(channelId);
    expect(payload.data["conversationId"]).toBe(channelId);
    expect(payload.data["senderId"]).toBe("raynor");
  });

  it("does NOT notify when the operator is the sender of their own post", async () => {
    const channelId = await makeChannel();

    const res = await api().post(`/api/channels/${channelId}/messages`).send({ body: "my own note", senderId: "user" });
    expect(res.status).toBe(201);
    expect(mockSendToAll).not.toHaveBeenCalled();
  });

  it("does NOT notify when APNs is not configured", async () => {
    mockConfigured.mockReturnValue(false);
    const channelId = await makeChannel();

    await api().post(`/api/channels/${channelId}/messages`).send({ body: "hi", senderId: "raynor" });
    expect(mockSendToAll).not.toHaveBeenCalled();
  });
});
