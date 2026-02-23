import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";
import type { MessageStore } from "../../src/services/message-store.js";

// Mock logger
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock wsBroadcast
const mockWsBroadcast = vi.fn();
vi.mock("../../src/services/ws-server.js", () => ({
  wsBroadcast: mockWsBroadcast,
}));

// Mock APNS
const mockSendNotificationToAll = vi.fn().mockResolvedValue({ success: true, data: { sent: 0, failed: 0 } });
const mockIsAPNsConfigured = vi.fn().mockReturnValue(false);
vi.mock("../../src/services/apns-service.js", () => ({
  sendNotificationToAll: mockSendNotificationToAll,
  isAPNsConfigured: mockIsAPNsConfigured,
}));

// Mock mcp-server (agent identity resolution)
const mockGetAgentBySession = vi.fn();
vi.mock("../../src/services/mcp-server.js", () => ({
  getAgentBySession: (...args: unknown[]) => mockGetAgentBySession(...args),
}));

// ============================================================================
// Helpers
// ============================================================================

let testDir: string;
let db: Database.Database;
let store: MessageStore;

function freshTestDir(): string {
  const dir = join(tmpdir(), `adjutant-mcp-msg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import("../../src/services/database.js");
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

async function setupStore(database: Database.Database): Promise<MessageStore> {
  const { createMessageStore } = await import("../../src/services/message-store.js");
  return createMessageStore(database);
}

// ============================================================================
// MCP Messaging Tools Tests
// ============================================================================

describe("MCP Messaging Tools", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
    store = await setupStore(db);
    vi.clearAllMocks();
    // Default: resolve "researcher" for any session
    mockGetAgentBySession.mockReturnValue("researcher");
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("registerMessagingTools", () => {
    it("should register all four messaging tools on the MCP server", async () => {
      const { registerMessagingTools } = await import("../../src/services/mcp-tools/messaging.js");

      const mockTool = vi.fn();
      const mockServer = { tool: mockTool } as any;

      registerMessagingTools(mockServer, store);

      expect(mockTool).toHaveBeenCalledTimes(4);
      const toolNames = mockTool.mock.calls.map((call: any[]) => call[0]);
      expect(toolNames).toContain("send_message");
      expect(toolNames).toContain("read_messages");
      expect(toolNames).toContain("list_threads");
      expect(toolNames).toContain("mark_read");
    });
  });

  describe("send_message tool", () => {
    it("should store a message and return messageId", async () => {
      const { registerMessagingTools } = await import("../../src/services/mcp-tools/messaging.js");

      const handlers = new Map<string, Function>();
      const mockServer = {
        tool: (name: string, _schema: any, handler: Function) => {
          handlers.set(name, handler);
        },
      } as any;

      registerMessagingTools(mockServer, store);

      const handler = handlers.get("send_message")!;
      const result = await handler(
        { to: "user", body: "Hello from agent", threadId: "thread-1" },
        { sessionId: "mcp-session-1", _meta: { agentId: "researcher" } },
      );

      // Should return content with messageId
      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe("text");

      const data = JSON.parse(result.content[0].text);
      expect(data.messageId).toBeTruthy();
      expect(data.timestamp).toBeTruthy();

      // Verify message was stored
      const stored = store.getMessage(data.messageId);
      expect(stored).not.toBeNull();
      expect(stored!.body).toBe("Hello from agent");
      expect(stored!.recipient).toBe("user");
      expect(stored!.role).toBe("agent");
      expect(stored!.threadId).toBe("thread-1");
    });

    it("should broadcast via WebSocket when message is sent", async () => {
      const { registerMessagingTools } = await import("../../src/services/mcp-tools/messaging.js");

      const handlers = new Map<string, Function>();
      const mockServer = {
        tool: (name: string, _schema: any, handler: Function) => {
          handlers.set(name, handler);
        },
      } as any;

      registerMessagingTools(mockServer, store);

      const handler = handlers.get("send_message")!;
      await handler(
        { to: "user", body: "Hello!", threadId: "t1" },
        { sessionId: "mcp-session-1", _meta: { agentId: "builder" } },
      );

      expect(mockWsBroadcast).toHaveBeenCalledTimes(1);
      const broadcastMsg = mockWsBroadcast.mock.calls[0][0];
      expect(broadcastMsg.type).toBe("chat_message");
      expect(broadcastMsg.body).toBe("Hello!");
      expect(broadcastMsg.from).toBeTruthy();
      expect(broadcastMsg.to).toBe("user");
    });

    it("should send APNS notification when configured and message is to user", async () => {
      mockIsAPNsConfigured.mockReturnValue(true);

      const { registerMessagingTools } = await import("../../src/services/mcp-tools/messaging.js");

      const handlers = new Map<string, Function>();
      const mockServer = {
        tool: (name: string, _schema: any, handler: Function) => {
          handlers.set(name, handler);
        },
      } as any;

      registerMessagingTools(mockServer, store);

      const handler = handlers.get("send_message")!;
      await handler(
        { to: "user", body: "Important update" },
        { sessionId: "mcp-session-1", _meta: { agentId: "researcher" } },
      );

      expect(mockSendNotificationToAll).toHaveBeenCalledTimes(1);
      const notification = mockSendNotificationToAll.mock.calls[0][0];
      expect(notification.title).toContain("researcher");
      expect(notification.body).toContain("Important update");
    });

    it("should skip APNS when not configured", async () => {
      mockIsAPNsConfigured.mockReturnValue(false);

      const { registerMessagingTools } = await import("../../src/services/mcp-tools/messaging.js");

      const handlers = new Map<string, Function>();
      const mockServer = {
        tool: (name: string, _schema: any, handler: Function) => {
          handlers.set(name, handler);
        },
      } as any;

      registerMessagingTools(mockServer, store);

      const handler = handlers.get("send_message")!;
      await handler(
        { to: "user", body: "Hello" },
        { sessionId: "mcp-session-1", _meta: { agentId: "builder" } },
      );

      expect(mockSendNotificationToAll).not.toHaveBeenCalled();
    });

    it("should store metadata when provided", async () => {
      const { registerMessagingTools } = await import("../../src/services/mcp-tools/messaging.js");

      const handlers = new Map<string, Function>();
      const mockServer = {
        tool: (name: string, _schema: any, handler: Function) => {
          handlers.set(name, handler);
        },
      } as any;

      registerMessagingTools(mockServer, store);

      const handler = handlers.get("send_message")!;
      const result = await handler(
        { to: "user", body: "With meta", metadata: { source: "test", priority: 1 } },
        { sessionId: "mcp-session-1", _meta: { agentId: "researcher" } },
      );

      const data = JSON.parse(result.content[0].text);
      const stored = store.getMessage(data.messageId);
      expect(stored!.metadata).toEqual({ source: "test", priority: 1 });
    });

    it("should resolve agent identity via server-side session lookup, ignoring client-supplied _meta", async () => {
      const { registerMessagingTools } = await import("../../src/services/mcp-tools/messaging.js");

      // Server-side lookup returns "server-resolved-agent"
      mockGetAgentBySession.mockReturnValue("server-resolved-agent");

      const handlers = new Map<string, Function>();
      const mockServer = {
        tool: (name: string, _schema: any, handler: Function) => {
          handlers.set(name, handler);
        },
      } as any;

      registerMessagingTools(mockServer, store);

      const handler = handlers.get("send_message")!;
      const result = await handler(
        { to: "user", body: "Identity test" },
        // Client sends _meta.agentId="qa-agent", but server should use session lookup
        { sessionId: "mcp-session-1", _meta: { agentId: "qa-agent" } },
      );

      const data = JSON.parse(result.content[0].text);
      const stored = store.getMessage(data.messageId);
      // Must use server-side resolved identity, not client-supplied _meta
      expect(stored!.agentId).toBe("server-resolved-agent");
      expect(mockGetAgentBySession).toHaveBeenCalledWith("mcp-session-1");
    });

    it("should return error when session is unknown", async () => {
      const { registerMessagingTools } = await import("../../src/services/mcp-tools/messaging.js");

      mockGetAgentBySession.mockReturnValue(undefined);

      const handlers = new Map<string, Function>();
      const mockServer = {
        tool: (name: string, _schema: any, handler: Function) => {
          handlers.set(name, handler);
        },
      } as any;

      registerMessagingTools(mockServer, store);

      const handler = handlers.get("send_message")!;
      const result = await handler(
        { to: "user", body: "Unknown session test" },
        { sessionId: "unknown-session" },
      );

      const data = JSON.parse(result.content[0].text);
      expect(data.error).toBe("Unknown session");
    });
  });

  describe("read_messages tool", () => {
    it("should return messages filtered by agentId", async () => {
      const { registerMessagingTools } = await import("../../src/services/mcp-tools/messaging.js");

      // Seed messages
      store.insertMessage({ agentId: "agent-A", role: "user", body: "Msg A1" });
      store.insertMessage({ agentId: "agent-B", role: "user", body: "Msg B1" });
      store.insertMessage({ agentId: "agent-A", role: "agent", body: "Msg A2" });

      const handlers = new Map<string, Function>();
      const mockServer = {
        tool: (name: string, _schema: any, handler: Function) => {
          handlers.set(name, handler);
        },
      } as any;

      registerMessagingTools(mockServer, store);

      const handler = handlers.get("read_messages")!;
      const result = await handler({ agentId: "agent-A" }, {});

      const data = JSON.parse(result.content[0].text);
      expect(data.messages).toHaveLength(2);
      expect(data.messages.every((m: any) => m.agentId === "agent-A")).toBe(true);
    });

    it("should return messages filtered by threadId", async () => {
      const { registerMessagingTools } = await import("../../src/services/mcp-tools/messaging.js");

      store.insertMessage({ agentId: "agent-A", role: "user", body: "T1 msg", threadId: "thread-1" });
      store.insertMessage({ agentId: "agent-A", role: "user", body: "T2 msg", threadId: "thread-2" });

      const handlers = new Map<string, Function>();
      const mockServer = {
        tool: (name: string, _schema: any, handler: Function) => {
          handlers.set(name, handler);
        },
      } as any;

      registerMessagingTools(mockServer, store);

      const handler = handlers.get("read_messages")!;
      const result = await handler({ threadId: "thread-1" }, {});

      const data = JSON.parse(result.content[0].text);
      expect(data.messages).toHaveLength(1);
      expect(data.messages[0].threadId).toBe("thread-1");
    });

    it("should support pagination with limit and before", async () => {
      const { registerMessagingTools } = await import("../../src/services/mcp-tools/messaging.js");

      for (let i = 0; i < 10; i++) {
        store.insertMessage({ agentId: "agent-A", role: "user", body: `Msg ${i}` });
      }

      const handlers = new Map<string, Function>();
      const mockServer = {
        tool: (name: string, _schema: any, handler: Function) => {
          handlers.set(name, handler);
        },
      } as any;

      registerMessagingTools(mockServer, store);

      const handler = handlers.get("read_messages")!;
      const result = await handler({ agentId: "agent-A", limit: 3 }, {});

      const data = JSON.parse(result.content[0].text);
      expect(data.messages).toHaveLength(3);
    });

    it("should return all messages when no filters provided", async () => {
      const { registerMessagingTools } = await import("../../src/services/mcp-tools/messaging.js");

      store.insertMessage({ agentId: "agent-A", role: "user", body: "One" });
      store.insertMessage({ agentId: "agent-B", role: "agent", body: "Two" });

      const handlers = new Map<string, Function>();
      const mockServer = {
        tool: (name: string, _schema: any, handler: Function) => {
          handlers.set(name, handler);
        },
      } as any;

      registerMessagingTools(mockServer, store);

      const handler = handlers.get("read_messages")!;
      const result = await handler({}, {});

      const data = JSON.parse(result.content[0].text);
      expect(data.messages).toHaveLength(2);
    });
  });

  describe("list_threads tool", () => {
    it("should return threads with message counts", async () => {
      const { registerMessagingTools } = await import("../../src/services/mcp-tools/messaging.js");

      store.insertMessage({ agentId: "agent-A", role: "user", body: "T1 first", threadId: "t1" });
      store.insertMessage({ agentId: "agent-A", role: "agent", body: "T1 reply", threadId: "t1" });
      store.insertMessage({ agentId: "agent-A", role: "user", body: "T2 only", threadId: "t2" });

      const handlers = new Map<string, Function>();
      const mockServer = {
        tool: (name: string, _schema: any, handler: Function) => {
          handlers.set(name, handler);
        },
      } as any;

      registerMessagingTools(mockServer, store);

      const handler = handlers.get("list_threads")!;
      const result = await handler({}, {});

      const data = JSON.parse(result.content[0].text);
      expect(data.threads.length).toBeGreaterThanOrEqual(2);

      const t1 = data.threads.find((t: any) => t.threadId === "t1");
      expect(t1).toBeTruthy();
      expect(t1.messageCount).toBe(2);
    });

    it("should filter threads by agentId", async () => {
      const { registerMessagingTools } = await import("../../src/services/mcp-tools/messaging.js");

      store.insertMessage({ agentId: "agent-A", role: "user", body: "A thread", threadId: "tA" });
      store.insertMessage({ agentId: "agent-B", role: "user", body: "B thread", threadId: "tB" });

      const handlers = new Map<string, Function>();
      const mockServer = {
        tool: (name: string, _schema: any, handler: Function) => {
          handlers.set(name, handler);
        },
      } as any;

      registerMessagingTools(mockServer, store);

      const handler = handlers.get("list_threads")!;
      const result = await handler({ agentId: "agent-A" }, {});

      const data = JSON.parse(result.content[0].text);
      expect(data.threads).toHaveLength(1);
      expect(data.threads[0].threadId).toBe("tA");
    });
  });

  describe("mark_read tool", () => {
    it("should mark a single message as read by messageId", async () => {
      const { registerMessagingTools } = await import("../../src/services/mcp-tools/messaging.js");

      const msg = store.insertMessage({
        id: "mark-me",
        agentId: "agent-A",
        role: "user",
        body: "Read me",
      });
      expect(msg.deliveryStatus).toBe("delivered");

      const handlers = new Map<string, Function>();
      const mockServer = {
        tool: (name: string, _schema: any, handler: Function) => {
          handlers.set(name, handler);
        },
      } as any;

      registerMessagingTools(mockServer, store);

      const handler = handlers.get("mark_read")!;
      const result = await handler({ messageId: "mark-me" }, {});

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const updated = store.getMessage("mark-me");
      expect(updated!.deliveryStatus).toBe("read");
    });

    it("should return error when neither messageId nor agentId is provided", async () => {
      const { registerMessagingTools } = await import("../../src/services/mcp-tools/messaging.js");

      const handlers = new Map<string, Function>();
      const mockServer = {
        tool: (name: string, _schema: any, handler: Function) => {
          handlers.set(name, handler);
        },
      } as any;

      registerMessagingTools(mockServer, store);

      const handler = handlers.get("mark_read")!;
      const result = await handler({}, {});

      const data = JSON.parse(result.content[0].text);
      expect(data.error).toBe("Either messageId or agentId is required");
    });

    it("should mark all messages from an agent as read", async () => {
      const { registerMessagingTools } = await import("../../src/services/mcp-tools/messaging.js");

      store.insertMessage({ agentId: "agent-A", role: "user", body: "M1" });
      store.insertMessage({ agentId: "agent-A", role: "agent", body: "M2" });
      store.insertMessage({ agentId: "agent-B", role: "user", body: "B1" });

      const handlers = new Map<string, Function>();
      const mockServer = {
        tool: (name: string, _schema: any, handler: Function) => {
          handlers.set(name, handler);
        },
      } as any;

      registerMessagingTools(mockServer, store);

      const handler = handlers.get("mark_read")!;
      const result = await handler({ agentId: "agent-A" }, {});

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);

      const agentAMsgs = store.getMessages({ agentId: "agent-A" });
      expect(agentAMsgs.every((m) => m.deliveryStatus === "read")).toBe(true);

      // agent-B unaffected
      const agentBMsgs = store.getMessages({ agentId: "agent-B" });
      expect(agentBMsgs[0]!.deliveryStatus).toBe("delivered");
    });
  });
});

// ============================================================================
// Messages REST API Tests
// ============================================================================

describe("Messages REST API", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
    store = await setupStore(db);
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("GET /api/messages", () => {
    it("should return messages filtered by agentId query param", async () => {
      const { createMessagesRouter } = await import("../../src/routes/messages.js");
      const express = (await import("express")).default;

      store.insertMessage({ agentId: "agent-A", role: "user", body: "A msg" });
      store.insertMessage({ agentId: "agent-B", role: "user", body: "B msg" });

      const app = express();
      app.use(express.json());
      app.use("/api/messages", createMessagesRouter(store));

      const { default: request } = await import("supertest");
      const res = await request(app).get("/api/messages?agentId=agent-A");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].agentId).toBe("agent-A");
    });

    it("should return messages filtered by threadId", async () => {
      const { createMessagesRouter } = await import("../../src/routes/messages.js");
      const express = (await import("express")).default;

      store.insertMessage({ agentId: "agent-A", role: "user", body: "T1", threadId: "thread-1" });
      store.insertMessage({ agentId: "agent-A", role: "user", body: "T2", threadId: "thread-2" });

      const app = express();
      app.use(express.json());
      app.use("/api/messages", createMessagesRouter(store));

      const { default: request } = await import("supertest");
      const res = await request(app).get("/api/messages?threadId=thread-1");

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].threadId).toBe("thread-1");
    });

    it("should support limit and pagination params", async () => {
      const { createMessagesRouter } = await import("../../src/routes/messages.js");
      const express = (await import("express")).default;

      for (let i = 0; i < 10; i++) {
        store.insertMessage({ agentId: "agent-A", role: "user", body: `Msg ${i}` });
      }

      const app = express();
      app.use(express.json());
      app.use("/api/messages", createMessagesRouter(store));

      const { default: request } = await import("supertest");
      const res = await request(app).get("/api/messages?limit=3");

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(3);
    });
  });

  describe("GET /api/messages/:id", () => {
    it("should return a single message by ID", async () => {
      const { createMessagesRouter } = await import("../../src/routes/messages.js");
      const express = (await import("express")).default;

      store.insertMessage({ id: "msg-123", agentId: "agent-A", role: "user", body: "Find me" });

      const app = express();
      app.use(express.json());
      app.use("/api/messages", createMessagesRouter(store));

      const { default: request } = await import("supertest");
      const res = await request(app).get("/api/messages/msg-123");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe("msg-123");
      expect(res.body.data.body).toBe("Find me");
    });

    it("should return 404 for non-existent message", async () => {
      const { createMessagesRouter } = await import("../../src/routes/messages.js");
      const express = (await import("express")).default;

      const app = express();
      app.use(express.json());
      app.use("/api/messages", createMessagesRouter(store));

      const { default: request } = await import("supertest");
      const res = await request(app).get("/api/messages/does-not-exist");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("PATCH /api/messages/:id/read", () => {
    it("should mark a message as read", async () => {
      const { createMessagesRouter } = await import("../../src/routes/messages.js");
      const express = (await import("express")).default;

      store.insertMessage({ id: "read-me", agentId: "agent-A", role: "user", body: "Read me" });

      const app = express();
      app.use(express.json());
      app.use("/api/messages", createMessagesRouter(store));

      const { default: request } = await import("supertest");
      const res = await request(app).patch("/api/messages/read-me/read");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const msg = store.getMessage("read-me");
      expect(msg!.deliveryStatus).toBe("read");
    });
  });

  describe("PATCH /api/messages/read-all", () => {
    it("should mark all messages from agent as read", async () => {
      const { createMessagesRouter } = await import("../../src/routes/messages.js");
      const express = (await import("express")).default;

      store.insertMessage({ agentId: "agent-A", role: "user", body: "M1" });
      store.insertMessage({ agentId: "agent-A", role: "agent", body: "M2" });

      const app = express();
      app.use(express.json());
      app.use("/api/messages", createMessagesRouter(store));

      const { default: request } = await import("supertest");
      const res = await request(app).patch("/api/messages/read-all?agentId=agent-A");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const msgs = store.getMessages({ agentId: "agent-A" });
      expect(msgs.every((m) => m.deliveryStatus === "read")).toBe(true);
    });
  });

  describe("POST /api/messages", () => {
    it("should send a message from user", async () => {
      const { createMessagesRouter } = await import("../../src/routes/messages.js");
      const express = (await import("express")).default;

      const app = express();
      app.use(express.json());
      app.use("/api/messages", createMessagesRouter(store));

      const { default: request } = await import("supertest");
      const res = await request(app)
        .post("/api/messages")
        .send({ to: "researcher", body: "Hello agent", threadId: "t1" });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messageId).toBeTruthy();

      // Verify stored
      const stored = store.getMessage(res.body.data.messageId);
      expect(stored).not.toBeNull();
      expect(stored!.body).toBe("Hello agent");
      expect(stored!.role).toBe("user");
      expect(stored!.recipient).toBe("researcher");
    });

    it("should return 400 when body is missing", async () => {
      const { createMessagesRouter } = await import("../../src/routes/messages.js");
      const express = (await import("express")).default;

      const app = express();
      app.use(express.json());
      app.use("/api/messages", createMessagesRouter(store));

      const { default: request } = await import("supertest");
      const res = await request(app)
        .post("/api/messages")
        .send({ to: "researcher" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /api/messages/unread", () => {
    it("should return unread counts per agent", async () => {
      const { createMessagesRouter } = await import("../../src/routes/messages.js");
      const express = (await import("express")).default;

      store.insertMessage({ agentId: "agent-A", role: "user", body: "A1" });
      store.insertMessage({ agentId: "agent-A", role: "user", body: "A2" });
      store.insertMessage({ agentId: "agent-B", role: "user", body: "B1" });

      const app = express();
      app.use(express.json());
      app.use("/api/messages", createMessagesRouter(store));

      const { default: request } = await import("supertest");
      const res = await request(app).get("/api/messages/unread");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.counts).toBeDefined();

      const agentA = res.body.data.counts.find((c: any) => c.agentId === "agent-A");
      expect(agentA.count).toBe(2);
    });
  });

  describe("GET /api/messages/threads", () => {
    it("should return threads list", async () => {
      const { createMessagesRouter } = await import("../../src/routes/messages.js");
      const express = (await import("express")).default;

      store.insertMessage({ agentId: "agent-A", role: "user", body: "T1", threadId: "thread-1" });
      store.insertMessage({ agentId: "agent-A", role: "agent", body: "T1 reply", threadId: "thread-1" });

      const app = express();
      app.use(express.json());
      app.use("/api/messages", createMessagesRouter(store));

      const { default: request } = await import("supertest");
      const res = await request(app).get("/api/messages/threads");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.threads).toHaveLength(1);
      expect(res.body.data.threads[0].threadId).toBe("thread-1");
      expect(res.body.data.threads[0].messageCount).toBe(2);
    });

    it("should filter threads by agentId query param", async () => {
      const { createMessagesRouter } = await import("../../src/routes/messages.js");
      const express = (await import("express")).default;

      store.insertMessage({ agentId: "agent-A", role: "user", body: "A", threadId: "tA" });
      store.insertMessage({ agentId: "agent-B", role: "user", body: "B", threadId: "tB" });

      const app = express();
      app.use(express.json());
      app.use("/api/messages", createMessagesRouter(store));

      const { default: request } = await import("supertest");
      const res = await request(app).get("/api/messages/threads?agentId=agent-A");

      expect(res.status).toBe(200);
      expect(res.body.data.threads).toHaveLength(1);
      expect(res.body.data.threads[0].threadId).toBe("tA");
    });
  });
});
