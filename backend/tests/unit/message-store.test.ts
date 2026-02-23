import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";

let testDir: string;
let db: Database.Database;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-msgstore-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

describe("message-store", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("insertMessage", () => {
    it("should store and return a message with generated id", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      const msg = store.insertMessage({
        agentId: "agent-001",
        role: "user",
        body: "Hello, world!",
      });

      expect(msg.id).toBeTruthy();
      expect(msg.agentId).toBe("agent-001");
      expect(msg.recipient).toBeNull();
      expect(msg.role).toBe("user");
      expect(msg.body).toBe("Hello, world!");
      expect(msg.deliveryStatus).toBe("delivered");
      expect(msg.createdAt).toBeTruthy();
      expect(msg.updatedAt).toBeTruthy();
    });

    it("should use provided id when given", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      const msg = store.insertMessage({
        id: "custom-id-123",
        agentId: "agent-001",
        role: "agent",
        body: "Response",
      });

      expect(msg.id).toBe("custom-id-123");
    });

    it("should store metadata as JSON", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      const msg = store.insertMessage({
        agentId: "agent-001",
        role: "system",
        body: "Status update",
        metadata: { source: "test", count: 42 },
      });

      expect(msg.metadata).toEqual({ source: "test", count: 42 });
    });

    it("should store recipient field", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      const msg = store.insertMessage({
        agentId: "agent-001",
        recipient: "user",
        role: "agent",
        body: "Hello user!",
      });

      expect(msg.recipient).toBe("user");
    });

    it("should store optional fields", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      const msg = store.insertMessage({
        agentId: "agent-001",
        role: "announcement",
        body: "Big news!",
        sessionId: "session-abc",
        threadId: "thread-xyz",
        eventType: "announcement",
      });

      expect(msg.sessionId).toBe("session-abc");
      expect(msg.threadId).toBe("thread-xyz");
      expect(msg.eventType).toBe("announcement");
    });
  });

  describe("getMessage", () => {
    it("should return a message by id", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      const inserted = store.insertMessage({
        id: "msg-get-test",
        agentId: "agent-001",
        role: "user",
        body: "Find me!",
      });

      const found = store.getMessage("msg-get-test");
      expect(found).not.toBeNull();
      expect(found?.id).toBe("msg-get-test");
      expect(found?.body).toBe("Find me!");
    });

    it("should return null for non-existent message", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      const found = store.getMessage("does-not-exist");
      expect(found).toBeNull();
    });
  });

  describe("getMessages", () => {
    it("should filter by agentId", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      store.insertMessage({ agentId: "agent-A", role: "user", body: "A1" });
      store.insertMessage({ agentId: "agent-B", role: "user", body: "B1" });
      store.insertMessage({ agentId: "agent-A", role: "agent", body: "A2" });

      const messages = store.getMessages({ agentId: "agent-A" });
      expect(messages).toHaveLength(2);
      expect(messages.every((m) => m.agentId === "agent-A")).toBe(true);
    });

    it("should filter by recipient", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      store.insertMessage({ agentId: "agent-A", recipient: "user", role: "agent", body: "To user" });
      store.insertMessage({ agentId: "agent-A", recipient: "admin", role: "agent", body: "To admin" });
      store.insertMessage({ agentId: "agent-A", role: "user", body: "No recipient" });

      const messages = store.getMessages({ recipient: "user" });
      expect(messages).toHaveLength(1);
      expect(messages[0]?.recipient).toBe("user");
    });

    it("should filter by threadId", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      store.insertMessage({ agentId: "agent-A", role: "user", body: "T1", threadId: "thread-1" });
      store.insertMessage({ agentId: "agent-A", role: "user", body: "T2", threadId: "thread-2" });
      store.insertMessage({ agentId: "agent-A", role: "agent", body: "T1b", threadId: "thread-1" });

      const messages = store.getMessages({ threadId: "thread-1" });
      expect(messages).toHaveLength(2);
      expect(messages.every((m) => m.threadId === "thread-1")).toBe(true);
    });

    it("should filter by sessionId", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      store.insertMessage({ agentId: "agent-A", role: "user", body: "S1", sessionId: "sess-1" });
      store.insertMessage({ agentId: "agent-A", role: "user", body: "S2", sessionId: "sess-2" });

      const messages = store.getMessages({ sessionId: "sess-1" });
      expect(messages).toHaveLength(1);
      expect(messages[0]?.sessionId).toBe("sess-1");
    });

    it("should respect limit parameter", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      for (let i = 0; i < 10; i++) {
        store.insertMessage({ agentId: "agent-A", role: "user", body: `Msg ${i}` });
      }

      const messages = store.getMessages({ agentId: "agent-A", limit: 3 });
      expect(messages).toHaveLength(3);
    });

    it("should support before cursor for pagination", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      const msgs = [];
      for (let i = 1; i <= 5; i++) {
        const m = store.insertMessage({
          id: `msg-${i.toString().padStart(3, "0")}`,
          agentId: "agent-A",
          role: "user",
          body: `Message ${i}`,
        });
        msgs.push(m);
      }

      // Get messages created before the last message
      const lastMsg = msgs[msgs.length - 1]!;
      const result = store.getMessages({ agentId: "agent-A", before: lastMsg.createdAt });
      // Should not include the last message
      expect(result.every((m) => m.id !== lastMsg.id)).toBe(true);
    });

    it("should support composite cursor (before + beforeId) for same-second pagination", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      // All messages will have the same created_at (second precision)
      const msgs = [];
      for (let i = 1; i <= 5; i++) {
        const m = store.insertMessage({
          id: `msg-comp-${i.toString().padStart(3, "0")}`,
          agentId: "agent-A",
          role: "user",
          body: `Message ${i}`,
        });
        msgs.push(m);
      }

      // Use composite cursor: before the message with id "msg-comp-003"
      const pivotMsg = msgs[2]!;
      const result = store.getMessages({
        agentId: "agent-A",
        before: pivotMsg.createdAt,
        beforeId: pivotMsg.id,
      });

      // Should only include messages with id < "msg-comp-003" (i.e., msg-comp-001, msg-comp-002)
      const resultIds = result.map((m) => m.id);
      expect(resultIds).not.toContain("msg-comp-003");
      expect(resultIds).not.toContain("msg-comp-004");
      expect(resultIds).not.toContain("msg-comp-005");
      expect(resultIds).toContain("msg-comp-001");
      expect(resultIds).toContain("msg-comp-002");
    });

    it("should support after cursor", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      const msgs = [];
      for (let i = 1; i <= 5; i++) {
        const m = store.insertMessage({
          id: `msg-after-${i.toString().padStart(3, "0")}`,
          agentId: "agent-A",
          role: "user",
          body: `Message ${i}`,
        });
        msgs.push(m);
      }

      const firstMsg = msgs[0]!;
      const result = store.getMessages({ agentId: "agent-A", after: firstMsg.createdAt });
      // Should not include the first message
      expect(result.every((m) => m.id !== firstMsg.id)).toBe(true);
    });

    it("should support composite cursor (after + afterId) for same-second pagination", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      const msgs = [];
      for (let i = 1; i <= 5; i++) {
        const m = store.insertMessage({
          id: `msg-aftercomp-${i.toString().padStart(3, "0")}`,
          agentId: "agent-A",
          role: "user",
          body: `Message ${i}`,
        });
        msgs.push(m);
      }

      // Use composite cursor: after the message with id "msg-aftercomp-003"
      const pivotMsg = msgs[2]!;
      const result = store.getMessages({
        agentId: "agent-A",
        after: pivotMsg.createdAt,
        afterId: pivotMsg.id,
      });

      const resultIds = result.map((m) => m.id);
      expect(resultIds).not.toContain("msg-aftercomp-001");
      expect(resultIds).not.toContain("msg-aftercomp-002");
      expect(resultIds).not.toContain("msg-aftercomp-003");
      expect(resultIds).toContain("msg-aftercomp-004");
      expect(resultIds).toContain("msg-aftercomp-005");
    });

    it("should return messages ordered by created_at descending, then id descending", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      // Use explicit IDs that sort lexicographically: aaa < bbb < ccc
      store.insertMessage({ id: "aaa", agentId: "agent-A", role: "user", body: "First" });
      store.insertMessage({ id: "bbb", agentId: "agent-A", role: "user", body: "Second" });
      store.insertMessage({ id: "ccc", agentId: "agent-A", role: "user", body: "Third" });

      const messages = store.getMessages({ agentId: "agent-A" });
      // Same created_at, so ordered by id DESC: ccc, bbb, aaa
      expect(messages[0]?.body).toBe("Third");
      expect(messages[1]?.body).toBe("Second");
      expect(messages[2]?.body).toBe("First");
    });
  });

  describe("conversation scoping (Fix 1)", () => {
    it("should return both agent messages AND user messages sent TO that agent", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      // Agent sends a message (agent_id = "agent-A", role = "agent")
      store.insertMessage({ agentId: "agent-A", role: "agent", body: "Hello from agent" });
      // User sends a message TO agent-A (agent_id = "user", role = "user", recipient = "agent-A")
      store.insertMessage({ agentId: "user", recipient: "agent-A", role: "user", body: "Hello to agent" });
      // Unrelated agent message
      store.insertMessage({ agentId: "agent-B", role: "agent", body: "Other agent" });
      // User sends to a different agent
      store.insertMessage({ agentId: "user", recipient: "agent-B", role: "user", body: "Hello to B" });

      const messages = store.getMessages({ agentId: "agent-A" });
      expect(messages).toHaveLength(2);
      const bodies = messages.map((m) => m.body).sort();
      expect(bodies).toEqual(["Hello from agent", "Hello to agent"]);
    });

    it("should scope search results to include user messages sent TO the agent", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      store.insertMessage({ agentId: "agent-A", role: "agent", body: "deploy the app" });
      store.insertMessage({ agentId: "user", recipient: "agent-A", role: "user", body: "please deploy now" });
      store.insertMessage({ agentId: "user", recipient: "agent-B", role: "user", body: "deploy for B" });

      const results = store.searchMessages("deploy", { agentId: "agent-A" });
      expect(results).toHaveLength(2);
      const bodies = results.map((m) => m.body).sort();
      expect(bodies).toEqual(["deploy the app", "please deploy now"]);
    });
  });

  describe("beforeId-to-timestamp fallback (Fix 2)", () => {
    it("should paginate correctly when only beforeId is provided (no before timestamp)", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      const msgs = [];
      for (let i = 1; i <= 5; i++) {
        const m = store.insertMessage({
          id: `msg-fallback-${i.toString().padStart(3, "0")}`,
          agentId: "agent-A",
          role: "user",
          body: `Message ${i}`,
        });
        msgs.push(m);
      }

      // Request with only beforeId (no before timestamp) - simulates iOS client behavior
      const pivotMsg = msgs[2]!; // msg-fallback-003
      const result = store.getMessages({
        agentId: "agent-A",
        beforeId: pivotMsg.id,
        // NOTE: no `before` timestamp provided
      });

      const resultIds = result.map((m) => m.id);
      expect(resultIds).toContain("msg-fallback-001");
      expect(resultIds).toContain("msg-fallback-002");
      expect(resultIds).not.toContain("msg-fallback-003");
      expect(resultIds).not.toContain("msg-fallback-004");
      expect(resultIds).not.toContain("msg-fallback-005");
    });
  });

  describe("markRead", () => {
    it("should update delivery_status to read", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      const msg = store.insertMessage({
        id: "mark-read-test",
        agentId: "agent-A",
        role: "user",
        body: "Read me",
      });

      expect(msg.deliveryStatus).toBe("delivered");

      store.markRead("mark-read-test");

      const updated = store.getMessage("mark-read-test");
      expect(updated?.deliveryStatus).toBe("read");
    });
  });

  describe("markAllRead", () => {
    it("should mark all messages for an agent as read", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      store.insertMessage({ agentId: "agent-A", role: "user", body: "Msg 1" });
      store.insertMessage({ agentId: "agent-A", role: "agent", body: "Msg 2" });
      store.insertMessage({ agentId: "agent-B", role: "user", body: "Other agent" });

      store.markAllRead("agent-A");

      const agentAMsgs = store.getMessages({ agentId: "agent-A" });
      expect(agentAMsgs.every((m) => m.deliveryStatus === "read")).toBe(true);

      // agent-B messages should be unaffected
      const agentBMsgs = store.getMessages({ agentId: "agent-B" });
      expect(agentBMsgs[0]?.deliveryStatus).toBe("delivered");
    });
  });

  describe("searchMessages", () => {
    it("should return FTS5 results matching query", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      store.insertMessage({ agentId: "agent-A", role: "user", body: "The quick brown fox jumps" });
      store.insertMessage({ agentId: "agent-A", role: "user", body: "Lazy dog sleeps all day" });
      store.insertMessage({ agentId: "agent-A", role: "user", body: "Fox and hound adventure" });

      const results = store.searchMessages("fox");
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.every((m) => m.body.toLowerCase().includes("fox"))).toBe(true);
    });

    it("should filter search results by agentId", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      store.insertMessage({ agentId: "agent-A", role: "user", body: "Deploy the application" });
      store.insertMessage({ agentId: "agent-B", role: "user", body: "Deploy the service" });

      const results = store.searchMessages("deploy", { agentId: "agent-A" });
      expect(results).toHaveLength(1);
      expect(results[0]?.agentId).toBe("agent-A");
    });

    it("should respect limit in search", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      for (let i = 0; i < 10; i++) {
        store.insertMessage({ agentId: "agent-A", role: "user", body: `Testing iteration ${i}` });
      }

      const results = store.searchMessages("testing", { limit: 3 });
      expect(results).toHaveLength(3);
    });
  });

  describe("getUnreadCounts", () => {
    it("should return per-agent unread counts", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      store.insertMessage({ agentId: "agent-A", role: "user", body: "A1" });
      store.insertMessage({ agentId: "agent-A", role: "user", body: "A2" });
      store.insertMessage({ agentId: "agent-B", role: "user", body: "B1" });

      // Mark one of agent-A's as read
      const agentAMsgs = store.getMessages({ agentId: "agent-A" });
      store.markRead(agentAMsgs[0]!.id);

      const counts = store.getUnreadCounts();
      const agentA = counts.find((c) => c.agentId === "agent-A");
      const agentB = counts.find((c) => c.agentId === "agent-B");

      expect(agentA?.count).toBe(1);
      expect(agentB?.count).toBe(1);
    });

    it("should not include agents with zero unread", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      store.insertMessage({ id: "read-msg", agentId: "agent-A", role: "user", body: "Read" });
      store.markRead("read-msg");

      const counts = store.getUnreadCounts();
      const agentA = counts.find((c) => c.agentId === "agent-A");
      expect(agentA).toBeUndefined();
    });
  });

  describe("getThreads", () => {
    it("should return threads with latest message info", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      store.insertMessage({ agentId: "agent-A", role: "user", body: "Thread 1 first", threadId: "t1" });
      store.insertMessage({ agentId: "agent-A", role: "agent", body: "Thread 1 reply", threadId: "t1" });
      store.insertMessage({ agentId: "agent-A", role: "user", body: "Thread 2 only", threadId: "t2" });

      const threads = store.getThreads();
      expect(threads.length).toBeGreaterThanOrEqual(2);

      const t1 = threads.find((t) => t.threadId === "t1");
      expect(t1).toBeTruthy();
      expect(t1?.messageCount).toBe(2);
      expect(t1?.latestBody).toBe("Thread 1 reply");
    });

    it("should filter threads by agentId", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      store.insertMessage({ agentId: "agent-A", role: "user", body: "A thread", threadId: "tA" });
      store.insertMessage({ agentId: "agent-B", role: "user", body: "B thread", threadId: "tB" });

      const threads = store.getThreads("agent-A");
      expect(threads).toHaveLength(1);
      expect(threads[0]?.threadId).toBe("tA");
    });

    it("should exclude messages with null threadId", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      store.insertMessage({ agentId: "agent-A", role: "user", body: "No thread" });
      store.insertMessage({ agentId: "agent-A", role: "user", body: "Has thread", threadId: "t1" });

      const threads = store.getThreads();
      expect(threads).toHaveLength(1);
      expect(threads[0]?.threadId).toBe("t1");
    });
  });

  describe("pagination edge cases", () => {
    it("should return empty array and hasMore:false when no messages exist", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      const messages = store.getMessages({ agentId: "agent-A", limit: 10 });
      expect(messages).toHaveLength(0);
    });

    it("should return single message and hasMore:false for 1-message store", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      store.insertMessage({ id: "only-msg", agentId: "agent-A", role: "user", body: "Solo" });

      const messages = store.getMessages({ agentId: "agent-A", limit: 10 });
      expect(messages).toHaveLength(1);
      expect(messages[0]?.id).toBe("only-msg");
    });

    it("should handle cursor pointing to the oldest message in the store", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      const msgs = [];
      for (let i = 1; i <= 3; i++) {
        const m = store.insertMessage({
          id: `cursor-edge-${i.toString().padStart(3, "0")}`,
          agentId: "agent-A",
          role: "user",
          body: `Msg ${i}`,
        });
        msgs.push(m);
      }

      // All messages will have the same created_at since they're inserted instantly.
      // Use the oldest message (sorted by id desc, so cursor-edge-001 is oldest)
      const oldest = msgs[0]!;
      const result = store.getMessages({
        agentId: "agent-A",
        before: oldest.createdAt,
        beforeId: oldest.id,
      });

      // Nothing should be older than the oldest message
      expect(result).toHaveLength(0);
    });

    it("should correctly paginate messages with identical timestamps using id tiebreaker", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      // Insert 5 messages — all in the same second (same created_at)
      for (let i = 1; i <= 5; i++) {
        store.insertMessage({
          id: `ts-tie-${String.fromCharCode(96 + i)}`, // ts-tie-a, ts-tie-b, ...
          agentId: "agent-A",
          role: "user",
          body: `Msg ${i}`,
        });
      }

      // Get page 1 (newest 2)
      const page1 = store.getMessages({ agentId: "agent-A", limit: 2 });
      expect(page1).toHaveLength(2);
      // Ordered DESC by id: ts-tie-e, ts-tie-d
      expect(page1[0]?.id).toBe("ts-tie-e");
      expect(page1[1]?.id).toBe("ts-tie-d");

      // Get page 2 using composite cursor from the oldest on page 1
      const cursor = page1[1]!;
      const page2 = store.getMessages({
        agentId: "agent-A",
        before: cursor.createdAt,
        beforeId: cursor.id,
        limit: 2,
      });
      expect(page2).toHaveLength(2);
      expect(page2[0]?.id).toBe("ts-tie-c");
      expect(page2[1]?.id).toBe("ts-tie-b");

      // Get page 3 from cursor of last on page 2
      const cursor2 = page2[1]!;
      const page3 = store.getMessages({
        agentId: "agent-A",
        before: cursor2.createdAt,
        beforeId: cursor2.id,
        limit: 2,
      });
      expect(page3).toHaveLength(1);
      expect(page3[0]?.id).toBe("ts-tie-a");
    });

    it("should handle beforeId that does not exist in the store", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      store.insertMessage({ id: "msg-aaa", agentId: "agent-A", role: "user", body: "First" });
      store.insertMessage({ id: "msg-bbb", agentId: "agent-A", role: "user", body: "Second" });
      store.insertMessage({ id: "msg-ccc", agentId: "agent-A", role: "user", body: "Third" });

      const refMsg = store.getMessage("msg-bbb")!;

      // Use a non-existent beforeId with a valid timestamp
      // The composite cursor (created_at = ? AND id < ?) should still work:
      // it returns messages whose id sorts before the fabricated cursor id
      const result = store.getMessages({
        agentId: "agent-A",
        before: refMsg.createdAt,
        beforeId: "msg-bbb-deleted",
      });

      // "msg-aaa" and "msg-bbb" sort before "msg-bbb-deleted" lexicographically
      // So they should be returned, but not "msg-ccc"
      const resultIds = result.map((m) => m.id);
      expect(resultIds).toContain("msg-aaa");
      expect(resultIds).toContain("msg-bbb");
      expect(resultIds).not.toContain("msg-ccc");
    });

    it("should return hasMore:true when more messages exist beyond the limit", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      for (let i = 0; i < 5; i++) {
        store.insertMessage({ agentId: "agent-A", role: "user", body: `Msg ${i}` });
      }

      const messages = store.getMessages({ agentId: "agent-A", limit: 3 });
      expect(messages).toHaveLength(3);
      // The store itself doesn't return hasMore — the route handler checks messages.length === limit.
      // Verify the underlying behavior: we got exactly limit messages.
      expect(messages.length).toBe(3);
    });

    it("should return fewer than limit when all messages have been returned", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      store.insertMessage({ agentId: "agent-A", role: "user", body: "Only one" });

      const messages = store.getMessages({ agentId: "agent-A", limit: 10 });
      expect(messages.length).toBeLessThan(10);
      expect(messages).toHaveLength(1);
    });

    it("should paginate correctly when filtered by agentId", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      // Insert interleaved messages from two agents
      for (let i = 1; i <= 6; i++) {
        const agent = i % 2 === 0 ? "agent-A" : "agent-B";
        store.insertMessage({
          id: `interleave-${i.toString().padStart(3, "0")}`,
          agentId: agent,
          role: "user",
          body: `Msg ${i} from ${agent}`,
        });
      }

      // Page 1: newest 2 from agent-A
      const page1 = store.getMessages({ agentId: "agent-A", limit: 2 });
      expect(page1).toHaveLength(2);
      expect(page1.every((m) => m.agentId === "agent-A")).toBe(true);

      // Page 2: use cursor from oldest on page 1
      const cursor = page1[1]!;
      const page2 = store.getMessages({
        agentId: "agent-A",
        before: cursor.createdAt,
        beforeId: cursor.id,
        limit: 2,
      });
      expect(page2).toHaveLength(1); // Only 3 total for agent-A
      expect(page2.every((m) => m.agentId === "agent-A")).toBe(true);
    });

    it("should not leak messages from other agents when paginating", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      store.insertMessage({ id: "leak-a1", agentId: "agent-A", role: "user", body: "A1" });
      store.insertMessage({ id: "leak-b1", agentId: "agent-B", role: "user", body: "B1" });
      store.insertMessage({ id: "leak-a2", agentId: "agent-A", role: "user", body: "A2" });
      store.insertMessage({ id: "leak-b2", agentId: "agent-B", role: "user", body: "B2" });

      // Get all pages for agent-A
      const allAgentA = store.getMessages({ agentId: "agent-A" });
      expect(allAgentA.every((m) => m.agentId === "agent-A")).toBe(true);
      expect(allAgentA.some((m) => m.agentId === "agent-B")).toBe(false);
    });

    it("should not return duplicates when new messages arrive between pagination calls", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      // Insert initial 5 messages
      for (let i = 1; i <= 5; i++) {
        store.insertMessage({
          id: `dup-test-${i.toString().padStart(3, "0")}`,
          agentId: "agent-A",
          role: "user",
          body: `Msg ${i}`,
        });
      }

      // Get first page
      const page1 = store.getMessages({ agentId: "agent-A", limit: 3 });
      expect(page1).toHaveLength(3);

      // Simulate new message arriving between pagination calls
      store.insertMessage({
        id: "dup-test-new",
        agentId: "agent-A",
        role: "user",
        body: "New arrival",
      });

      // Get second page using cursor from oldest in page 1
      const cursor = page1[page1.length - 1]!;
      const page2 = store.getMessages({
        agentId: "agent-A",
        before: cursor.createdAt,
        beforeId: cursor.id,
        limit: 3,
      });

      // Combine pages and check for duplicates
      const allIds = [...page1.map((m) => m.id), ...page2.map((m) => m.id)];
      const uniqueIds = new Set(allIds);
      expect(allIds.length).toBe(uniqueIds.size);

      // The new message should NOT appear in page2 (it's newer than cursor)
      expect(page2.some((m) => m.id === "dup-test-new")).toBe(false);
    });
  });
});
