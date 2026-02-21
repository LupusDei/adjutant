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
      expect(msg.role).toBe("user");
      expect(msg.body).toBe("Hello, world!");
      expect(msg.deliveryStatus).toBe("sent");
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

      // Insert with explicit IDs and timestamps to control ordering
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

    it("should return messages ordered by created_at descending", async () => {
      const { createMessageStore } = await import("../../src/services/message-store.js");
      const store = createMessageStore(db);

      store.insertMessage({ agentId: "agent-A", role: "user", body: "First" });
      store.insertMessage({ agentId: "agent-A", role: "user", body: "Second" });
      store.insertMessage({ agentId: "agent-A", role: "user", body: "Third" });

      const messages = store.getMessages({ agentId: "agent-A" });
      // Most recent first
      expect(messages[0]?.body).toBe("Third");
      expect(messages[2]?.body).toBe("First");
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

      expect(msg.deliveryStatus).toBe("sent");

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
      expect(agentBMsgs[0]?.deliveryStatus).toBe("sent");
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
});
