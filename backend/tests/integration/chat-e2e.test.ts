/**
 * E2E integration (adj-164.7.4): the two headline invariants of the chat
 * overhaul, exercised end-to-end through routes → services → store.
 *
 *  1. DM no-bleed — two distinct DM conversations never leak into each other.
 *  2. Channel multi-party — a channel with the user + ≥2 agents delivers to all
 *     members; a non-member is excluded both at the write boundary (403) and
 *     from the channel transcript, and channel traffic never bleeds into a DM.
 *
 * Lightweight express + in-memory sqlite + supertest. `ws-server` is mocked so
 * fan-out is observable without a live socket (the live/sync membership scoping
 * itself is proven in ws-room-fanout.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import express, { type Express } from "express";
import Database from "better-sqlite3";
import supertest from "supertest";

import { runMigrations } from "../../src/services/database.js";
import { createMessageStore, type MessageStore } from "../../src/services/message-store.js";
import { createConversationStore, type ConversationStore } from "../../src/services/conversation-store.js";
import { createConversationsRouter } from "../../src/routes/conversations.js";
import { createChannelsRouter } from "../../src/routes/channels.js";

const mockFanout = vi.fn();
vi.mock("../../src/services/ws-server.js", () => ({
  wsBroadcastToConversation: (...args: unknown[]) => mockFanout(...args),
}));

let app: Express;
let server: http.Server;
let db: Database.Database;
let convStore: ConversationStore;
let msgStore: MessageStore;

function api(): supertest.Agent {
  return supertest.agent(app);
}

beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  msgStore = createMessageStore(db);
  convStore = createConversationStore(db, msgStore);
  vi.clearAllMocks();

  app = express();
  app.use(express.json());
  app.use("/api/conversations", createConversationsRouter(convStore, msgStore));
  app.use("/api/channels", createChannelsRouter(convStore));

  await new Promise<void>((resolve) => { server = app.listen(0, () => { resolve(); }); });
});

afterEach(async () => {
  await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
  db.close();
});

describe("chat E2E — DM no-bleed", () => {
  it("keeps two DM conversations strictly isolated end-to-end", async () => {
    // Resolve the two DM conversations through the real deterministic endpoint.
    const dmRaynor = (await api().get("/api/conversations/dm/raynor")).body.data.conversation.id as string;
    const dmKerrigan = (await api().get("/api/conversations/dm/kerrigan")).body.data.conversation.id as string;
    expect(dmRaynor).not.toBe(dmKerrigan);

    // Seed each DM via the store (the send path stamps conversationId likewise).
    msgStore.insertMessage({ agentId: "raynor", recipient: "user", role: "agent", body: "raynor-only secret", conversationId: dmRaynor });
    msgStore.insertMessage({ agentId: "kerrigan", recipient: "user", role: "agent", body: "kerrigan-only secret", conversationId: dmKerrigan });

    const raynorView = (await api().get(`/api/conversations/${dmRaynor}/messages`)).body.data.items as { body: string }[];
    const kerriganView = (await api().get(`/api/conversations/${dmKerrigan}/messages`)).body.data.items as { body: string }[];

    expect(raynorView.map((m) => m.body)).toEqual(["raynor-only secret"]);
    expect(kerriganView.map((m) => m.body)).toEqual(["kerrigan-only secret"]);
    expect(raynorView.some((m) => m.body.includes("kerrigan"))).toBe(false);
    expect(kerriganView.some((m) => m.body.includes("raynor"))).toBe(false);
  });
});

describe("chat E2E — channel multi-party", () => {
  it("delivers to all members, excludes non-members, and does not bleed into DMs", async () => {
    // Create a channel; creator "user" is an owner-member.
    const channelId = (await api().post("/api/channels").send({ title: "ops" })).body.data.id as string;
    await api().post(`/api/channels/${channelId}/join`).send({ memberId: "raynor", memberKind: "agent" });
    await api().post(`/api/channels/${channelId}/join`).send({ memberId: "kerrigan", memberKind: "agent" });

    const memberIds = convStore.getMembers(channelId).map((m) => m.memberId).sort();
    expect(memberIds).toEqual(["kerrigan", "raynor", "user"]);

    // A member posts — 201 + fan-out invoked for the channel.
    const post = await api().post(`/api/channels/${channelId}/messages`).send({ body: "rally point set", senderId: "raynor" });
    expect(post.status).toBe(201);
    expect(mockFanout).toHaveBeenCalledWith(channelId, expect.objectContaining({ conversationId: channelId, from: "raynor" }));

    // Every member sees it in the channel transcript.
    const transcript = (await api().get(`/api/conversations/${channelId}/messages`)).body.data.items as { body: string }[];
    expect(transcript.map((m) => m.body)).toContain("rally point set");

    // A non-member (zeratul) cannot post — 403, no fan-out for that attempt.
    mockFanout.mockClear();
    const denied = await api().post(`/api/channels/${channelId}/messages`).send({ body: "intrusion", senderId: "zeratul" });
    expect(denied.status).toBe(403);
    expect(mockFanout).not.toHaveBeenCalled();

    // Channel traffic must not bleed into an unrelated DM conversation.
    const dmRaynor = (await api().get("/api/conversations/dm/raynor")).body.data.conversation.id as string;
    const dmView = (await api().get(`/api/conversations/${dmRaynor}/messages`)).body.data.items as { body: string }[];
    expect(dmView.some((m) => m.body === "rally point set")).toBe(false);
  });
});
