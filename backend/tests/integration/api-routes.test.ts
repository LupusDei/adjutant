/**
 * Integration tests for REST API routes.
 *
 * These tests spin up a real Express server with an in-memory SQLite database
 * and make actual HTTP requests to verify cross-service boundaries:
 * Route -> Service -> Database -> Response.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

import { TestHarness } from "./helpers/test-harness.js";

describe("REST API Integration", () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = new TestHarness();
    await harness.start();
  });

  afterAll(async () => {
    await harness.stop();
  });

  // =========================================================================
  // Health endpoint
  // =========================================================================

  describe("GET /health", () => {
    it("should return 200 with ok status", async () => {
      const res = await harness.request().get("/health");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok" });
    });
  });

  // =========================================================================
  // Messages API — POST + GET round-trip
  // =========================================================================

  describe("Messages API", () => {
    describe("POST /api/messages -> GET /api/messages round-trip", () => {
      it("should store a message and retrieve it", async () => {
        const sendRes = await harness.sendMessage("test-agent", "Hello from integration test");
        expect(sendRes.status).toBe(201);
        expect(sendRes.body.success).toBe(true);
        expect(sendRes.body.data.messageId).toBeDefined();

        const messageId = sendRes.body.data.messageId as string;

        // Retrieve by ID
        const getRes = await harness.getMessage(messageId);
        expect(getRes.status).toBe(200);
        expect(getRes.body.success).toBe(true);
        expect(getRes.body.data.body).toBe("Hello from integration test");
        expect(getRes.body.data.agentId).toBe("user");
        expect(getRes.body.data.recipient).toBe("test-agent");
        expect(getRes.body.data.role).toBe("user");
      });

      it("should return 400 for missing required fields", async () => {
        const res = await harness.request().post("/api/messages").send({});
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("should return 400 for empty body", async () => {
        const res = await harness.request().post("/api/messages").send({
          to: "agent-1",
          body: "",
        });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it("should return 404 for non-existent message ID", async () => {
        const res = await harness.getMessage("non-existent-id");
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
      });
    });

    describe("GET /api/messages with agentId filter", () => {
      it("should filter messages by agentId", async () => {
        // Insert messages for different agents directly
        harness.insertMessageDirect({
          agentId: "alpha",
          role: "agent",
          body: "Message from alpha",
        });
        harness.insertMessageDirect({
          agentId: "bravo",
          role: "agent",
          body: "Message from bravo",
        });
        // User message TO alpha (should also appear in alpha's feed)
        harness.insertMessageDirect({
          agentId: "user",
          role: "user",
          body: "User message to alpha",
          recipient: "alpha",
        });

        const res = await harness.getMessages({ agentId: "alpha" });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const items = res.body.data.items as { agentId: string; body: string; recipient: string | null }[];
        // Should include alpha's own messages AND user messages to alpha
        const bodies = items.map((m) => m.body);
        expect(bodies).toContain("Message from alpha");
        expect(bodies).toContain("User message to alpha");
        expect(bodies).not.toContain("Message from bravo");
      });
    });

    describe("GET /api/messages with threadId filter", () => {
      it("should filter messages by threadId", async () => {
        const threadId = "test-thread-123";
        harness.insertMessageDirect({
          agentId: "agent-x",
          role: "agent",
          body: "Threaded message 1",
          threadId,
        });
        harness.insertMessageDirect({
          agentId: "agent-x",
          role: "agent",
          body: "Threaded message 2",
          threadId,
        });
        harness.insertMessageDirect({
          agentId: "agent-x",
          role: "agent",
          body: "Non-threaded message",
        });

        const res = await harness.getMessages({ threadId });
        expect(res.status).toBe(200);
        const items = res.body.data.items as { body: string }[];
        expect(items).toHaveLength(2);
        expect(items.every((m) => m.body.startsWith("Threaded"))).toBe(true);
      });
    });

    describe("GET /api/messages pagination", () => {
      it("should respect limit parameter", async () => {
        // Insert several messages
        for (let i = 0; i < 5; i++) {
          harness.insertMessageDirect({
            agentId: "paginator",
            role: "agent",
            body: `Pagination test ${i}`,
          });
        }

        const res = await harness.getMessages({
          agentId: "paginator",
          limit: "2",
        });
        expect(res.status).toBe(200);
        expect(res.body.data.items).toHaveLength(2);
        expect(res.body.data.hasMore).toBe(true);
      });
    });

    describe("GET /api/messages/unread", () => {
      it("should return unread counts per agent", async () => {
        // Insert unread messages
        harness.insertMessageDirect({
          agentId: "unread-agent",
          role: "agent",
          body: "Unread message 1",
        });
        harness.insertMessageDirect({
          agentId: "unread-agent",
          role: "agent",
          body: "Unread message 2",
        });

        const res = await harness.getUnreadCounts();
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const counts = res.body.data.counts as { agentId: string; count: number }[];
        const agentCount = counts.find((c) => c.agentId === "unread-agent");
        expect(agentCount).toBeDefined();
        expect(agentCount!.count).toBeGreaterThanOrEqual(2);
      });
    });

    describe("PATCH /api/messages/:id/read", () => {
      it("should mark a message as read", async () => {
        const msg = harness.insertMessageDirect({
          agentId: "read-test-agent",
          role: "agent",
          body: "Mark me as read",
        });

        // Initially pending
        let getRes = await harness.getMessage(msg.id);
        expect(getRes.body.data.deliveryStatus).toBe("pending");

        // Mark as read
        const patchRes = await harness.markRead(msg.id);
        expect(patchRes.status).toBe(200);
        expect(patchRes.body.data.read).toBe(true);

        // Verify status changed
        getRes = await harness.getMessage(msg.id);
        expect(getRes.body.data.deliveryStatus).toBe("read");
      });
    });

    describe("PATCH /api/messages/read-all", () => {
      it("should mark all messages from an agent as read", async () => {
        const agentId = "bulk-read-agent";
        harness.insertMessageDirect({
          agentId,
          role: "agent",
          body: "Bulk read 1",
        });
        harness.insertMessageDirect({
          agentId,
          role: "agent",
          body: "Bulk read 2",
        });

        const patchRes = await harness.markAllRead(agentId);
        expect(patchRes.status).toBe(200);

        // Verify all are now read
        const msgs = harness.messageStore.getMessages({ agentId });
        for (const m of msgs) {
          if (m.agentId === agentId) {
            expect(m.deliveryStatus).toBe("read");
          }
        }
      });

      it("should return 400 when agentId is missing", async () => {
        const res = await harness.request().patch("/api/messages/read-all");
        expect(res.status).toBe(400);
      });
    });

    describe("GET /api/messages/threads", () => {
      it("should list threads", async () => {
        const threadId = "thread-list-test";
        harness.insertMessageDirect({
          agentId: "thread-agent",
          role: "agent",
          body: "Thread msg 1",
          threadId,
        });
        harness.insertMessageDirect({
          agentId: "thread-agent",
          role: "agent",
          body: "Thread msg 2",
          threadId,
        });

        const res = await harness.getThreads();
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const threads = res.body.data.threads as { threadId: string; messageCount: number }[];
        const ourThread = threads.find((t) => t.threadId === threadId);
        expect(ourThread).toBeDefined();
        expect(ourThread!.messageCount).toBe(2);
      });

      it("should filter threads by agentId", async () => {
        const res = await harness.getThreads("thread-agent");
        expect(res.status).toBe(200);
        const threads = res.body.data.threads as { threadId: string }[];
        expect(threads.length).toBeGreaterThan(0);
      });
    });
  });
});
