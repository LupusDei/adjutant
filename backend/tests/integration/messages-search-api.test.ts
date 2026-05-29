/**
 * Integration: GET /api/messages/search (adj-164.7.1).
 *
 * Proves the route → store wiring for FTS search and conversation-scoping.
 * Lightweight express + in-memory sqlite + supertest (no TestHarness — avoids
 * the parallel-load flake in test-harness.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import express, { type Express } from "express";
import Database from "better-sqlite3";
import supertest from "supertest";

import { runMigrations } from "../../src/services/database.js";
import { createMessageStore, type MessageStore } from "../../src/services/message-store.js";
import { createMessagesRouter } from "../../src/routes/messages.js";

let app: Express;
let server: http.Server;
let db: Database.Database;
let msgStore: MessageStore;

function agent(): supertest.Agent {
  return supertest.agent(app);
}

beforeEach(async () => {
  db = new Database(":memory:");
  runMigrations(db);
  msgStore = createMessageStore(db);

  app = express();
  app.use(express.json());
  app.use("/api/messages", createMessagesRouter(msgStore));

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => { resolve(); });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
  db.close();
});

describe("GET /api/messages/search", () => {
  it("should scope FTS results to a conversationId (success + bleed-free)", async () => {
    msgStore.insertMessage({ agentId: "raynor", role: "agent", body: "deploy the rollout pipeline", conversationId: "conv-a" });
    msgStore.insertMessage({ agentId: "kerrigan", role: "agent", body: "rollout to staging", conversationId: "conv-b" });

    const res = await agent().get("/api/messages/search?q=rollout&conversationId=conv-a");
    expect(res.status).toBe(200);
    const bodies = (res.body.data.items as { body: string }[]).map((m) => m.body);
    expect(bodies).toEqual(["deploy the rollout pipeline"]);
    expect(bodies).not.toContain("rollout to staging");
  });

  it("should return an empty result for a blank query (validation/edge)", async () => {
    const res = await agent().get("/api/messages/search?q=");
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });
});
