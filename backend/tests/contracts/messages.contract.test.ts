/**
 * Messages API contract tests.
 *
 * Validates message endpoint responses match declared Zod schemas.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ============================================================================
// Mocks
// ============================================================================

vi.mock("../../src/services/ws-server.js", () => ({
  wsBroadcast: vi.fn(),
}));

vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: vi.fn().mockReturnValue({
    registry: { findByName: vi.fn().mockReturnValue([]) },
    sendInput: vi.fn().mockResolvedValue(false),
  }),
}));

vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: vi.fn().mockReturnValue({
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  }),
}));

vi.mock("../../src/services/agents-service.js", () => ({
  getAgents: vi.fn().mockResolvedValue({ success: true, data: [] }),
}));

import { createMessagesRouter } from "../../src/routes/messages.js";
import {
  MessageListResponseSchema,
  SingleMessageResponseSchema,
  UnreadResponseSchema,
  ThreadsResponseSchema,
  SendMessageResponseSchema,
  MarkReadResponseSchema,
  ApiErrorSchema,
} from "../../src/types/api-contracts.js";

// ============================================================================
// Mock message store
// ============================================================================

const MOCK_MESSAGE = {
  id: "msg-001",
  agentId: "kerrigan",
  role: "agent",
  body: "Build complete. All tests pass.",
  createdAt: "2026-03-11T10:00:00.000Z",
  threadId: null,
  metadata: null,
  delivered: true,
};

function createMockStore() {
  return {
    getMessages: vi.fn().mockReturnValue([MOCK_MESSAGE]),
    getMessage: vi.fn().mockReturnValue(MOCK_MESSAGE),
    getUnreadCounts: vi.fn().mockReturnValue([{ agentId: "kerrigan", count: 3 }]),
    getThreads: vi.fn().mockReturnValue([{ threadId: "general", messageCount: 5 }]),
    insertMessage: vi.fn().mockReturnValue({ ...MOCK_MESSAGE, id: "msg-002" }),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    markDelivered: vi.fn(),
    getUnreadSummaries: vi.fn().mockReturnValue([]),
  };
}

// ============================================================================
// Tests
// ============================================================================

function createTestApp(store: ReturnType<typeof createMockStore>) {
  const app = express();
  app.use(express.json());
  app.use("/api/messages", createMessagesRouter(store as any));
  return app;
}

describe("Messages API contracts", () => {
  let app: express.Express;
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
    app = createTestApp(store);
    vi.clearAllMocks();
  });

  describe("GET /api/messages", () => {
    it("response matches MessageListResponseSchema", async () => {
      store.getMessages.mockReturnValue([MOCK_MESSAGE]);

      const res = await request(app).get("/api/messages");

      expect(res.status).toBe(200);
      const parsed = MessageListResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });
  });

  describe("GET /api/messages/unread", () => {
    it("response matches UnreadResponseSchema", async () => {
      store.getUnreadCounts.mockReturnValue([{ agentId: "kerrigan", count: 3 }]);

      const res = await request(app).get("/api/messages/unread");

      expect(res.status).toBe(200);
      const parsed = UnreadResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });
  });

  describe("GET /api/messages/threads", () => {
    it("response matches ThreadsResponseSchema", async () => {
      store.getThreads.mockReturnValue([{ threadId: "general", messageCount: 5 }]);

      const res = await request(app).get("/api/messages/threads");

      expect(res.status).toBe(200);
      const parsed = ThreadsResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });
  });

  describe("GET /api/messages/:id", () => {
    it("response matches SingleMessageResponseSchema", async () => {
      store.getMessage.mockReturnValue(MOCK_MESSAGE);

      const res = await request(app).get("/api/messages/msg-001");

      expect(res.status).toBe(200);
      const parsed = SingleMessageResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });

    it("returns 404 with error schema when not found", async () => {
      store.getMessage.mockReturnValue(undefined);

      const res = await request(app).get("/api/messages/nonexistent");

      expect(res.status).toBe(404);
      const parsed = ApiErrorSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });
  });

  describe("PATCH /api/messages/:id/read", () => {
    it("response matches MarkReadResponseSchema", async () => {
      store.getMessage.mockReturnValue(MOCK_MESSAGE);

      const res = await request(app).patch("/api/messages/msg-001/read");

      expect(res.status).toBe(200);
      const parsed = MarkReadResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });
  });

  describe("PATCH /api/messages/read-all", () => {
    it("response matches MarkReadResponseSchema", async () => {
      const res = await request(app).patch("/api/messages/read-all").query({ agentId: "kerrigan" });

      expect(res.status).toBe(200);
      const parsed = MarkReadResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });

    it("returns 400 when agentId missing", async () => {
      const res = await request(app).patch("/api/messages/read-all");

      expect(res.status).toBe(400);
      const parsed = ApiErrorSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });
  });

  describe("POST /api/messages", () => {
    it("response matches SendMessageResponseSchema", async () => {
      store.insertMessage.mockReturnValue({
        ...MOCK_MESSAGE,
        id: "msg-002",
        createdAt: "2026-03-11T12:00:00.000Z",
        threadId: null,
      });

      const res = await request(app)
        .post("/api/messages")
        .send({ to: "kerrigan", body: "Hey, status update?" });

      expect(res.status).toBe(201);
      const parsed = SendMessageResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
      if (!parsed.success) console.error(parsed.error.issues);
    });

    it("returns 400 with error schema on invalid body", async () => {
      const res = await request(app)
        .post("/api/messages")
        .send({ to: "kerrigan" }); // missing body

      expect(res.status).toBe(400);
      const parsed = ApiErrorSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });
  });
});
