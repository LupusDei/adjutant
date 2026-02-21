import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createMessageStore, type MessageStore } from "../../src/services/message-store.js";
import {
  registerStatusTools,
  getAgentStatuses,
  resetAgentStatuses,
  type AgentStatus,
} from "../../src/services/mcp-tools/status.js";

// ---------------------------------------------------------------------------
// Mock wsBroadcast so we can verify WebSocket events
// ---------------------------------------------------------------------------
const mockWsBroadcast = vi.fn();
vi.mock("../../src/services/ws-server.js", () => ({
  wsBroadcast: (...args: unknown[]) => mockWsBroadcast(...args),
}));

// Mock mcp-server to return agent identity from session
const mockGetAgentBySession = vi.fn();
vi.mock("../../src/services/mcp-server.js", () => ({
  getAgentBySession: (...args: unknown[]) => mockGetAgentBySession(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an in-memory SQLite database with the messages table. */
function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      agent_id TEXT NOT NULL,
      recipient TEXT,
      role TEXT NOT NULL CHECK(role IN ('user','agent','system','announcement')),
      body TEXT NOT NULL,
      metadata TEXT,
      delivery_status TEXT DEFAULT 'pending' CHECK(delivery_status IN ('pending','sent','delivered','read','failed')),
      event_type TEXT,
      thread_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      body, content=messages, content_rowid=rowid
    );
    CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
    END;
  `);
  return db;
}

/**
 * Build a fake McpServer that captures tool registrations so we can invoke them in tests.
 */
interface RegisteredTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<unknown>;
}

function createFakeMcpServer() {
  const tools: RegisteredTool[] = [];

  return {
    /** Mimics McpServer.tool(name, schema, handler) */
    tool(
      name: string,
      descriptionOrSchema: string | Record<string, unknown>,
      schemaOrCb: Record<string, unknown> | ((...args: unknown[]) => Promise<unknown>),
      maybeCb?: (...args: unknown[]) => Promise<unknown>,
    ) {
      // Support both tool(name, description, schema, cb) and tool(name, schema, cb)
      if (typeof descriptionOrSchema === "string") {
        tools.push({
          name,
          description: descriptionOrSchema,
          schema: schemaOrCb as Record<string, unknown>,
          handler: maybeCb as RegisteredTool["handler"],
        });
      } else {
        tools.push({
          name,
          description: "",
          schema: descriptionOrSchema,
          handler: schemaOrCb as RegisteredTool["handler"],
        });
      }
    },
    getTools: () => tools,
    getTool: (name: string) => tools.find((t) => t.name === name),
  };
}

function fakeExtra(sessionId = "session-abc") {
  return { sessionId, signal: new AbortController().signal, requestId: "req-1", sendNotification: vi.fn(), sendRequest: vi.fn() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("MCP Status Tools", () => {
  let db: Database.Database;
  let store: MessageStore;
  let server: ReturnType<typeof createFakeMcpServer>;

  beforeEach(() => {
    db = createTestDb();
    store = createMessageStore(db);
    server = createFakeMcpServer();
    resetAgentStatuses();
    mockWsBroadcast.mockReset();
    mockGetAgentBySession.mockReset();
    // Default: all tool calls come from "agent-1"
    mockGetAgentBySession.mockReturnValue("agent-1");

    // Register the tools with the fake server
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerStatusTools(server as any, store);
  });

  afterEach(() => {
    db.close();
  });

  // ========================================================================
  // set_status
  // ========================================================================
  describe("set_status", () => {
    it("should be registered as a tool", () => {
      expect(server.getTool("set_status")).toBeDefined();
    });

    it("should store status and return acknowledged", async () => {
      const tool = server.getTool("set_status")!;
      const result = await tool.handler(
        { status: "working", task: "Implementing feature X", beadId: "adj-42" },
        fakeExtra(),
      );
      expect(result).toEqual({
        content: [{ type: "text", text: expect.stringContaining("acknowledged") }],
      });

      const statuses = getAgentStatuses();
      expect(statuses.get("agent-1")).toMatchObject({
        agentId: "agent-1",
        status: "working",
        task: "Implementing feature X",
        beadId: "adj-42",
      });
    });

    it("should broadcast agent_status via WebSocket", async () => {
      const tool = server.getTool("set_status")!;
      await tool.handler(
        { status: "blocked", task: "Waiting on review" },
        fakeExtra(),
      );

      expect(mockWsBroadcast).toHaveBeenCalledTimes(1);
      const broadcast = mockWsBroadcast.mock.calls[0]![0];
      expect(broadcast.type).toBe("typing");
      expect(broadcast.from).toBe("agent-1");
      expect(broadcast.state).toBe("blocked");
      expect(broadcast.metadata).toMatchObject({
        task: "Waiting on review",
      });
    });

    it("should update status for existing agent", async () => {
      const tool = server.getTool("set_status")!;
      await tool.handler({ status: "working", task: "Task A" }, fakeExtra());
      await tool.handler({ status: "idle" }, fakeExtra());

      const statuses = getAgentStatuses();
      expect(statuses.get("agent-1")?.status).toBe("idle");
    });

    it("should return error for unknown session", async () => {
      mockGetAgentBySession.mockReturnValue(undefined);
      const tool = server.getTool("set_status")!;
      const result = await tool.handler(
        { status: "working" },
        fakeExtra("unknown-session"),
      );

      expect(result).toEqual({
        content: [{ type: "text", text: expect.stringContaining("Unknown agent") }],
        isError: true,
      });
    });
  });

  // ========================================================================
  // report_progress
  // ========================================================================
  describe("report_progress", () => {
    it("should be registered as a tool", () => {
      expect(server.getTool("report_progress")).toBeDefined();
    });

    it("should broadcast progress via WebSocket", async () => {
      const tool = server.getTool("report_progress")!;
      const result = await tool.handler(
        { task: "Building MCP tools", percentage: 75, description: "3 of 4 tools done" },
        fakeExtra(),
      );

      expect(result).toEqual({
        content: [{ type: "text", text: expect.stringContaining("acknowledged") }],
      });

      expect(mockWsBroadcast).toHaveBeenCalledTimes(1);
      const broadcast = mockWsBroadcast.mock.calls[0]![0];
      expect(broadcast.type).toBe("typing");
      expect(broadcast.from).toBe("agent-1");
      expect(broadcast.state).toBe("working");
      expect(broadcast.metadata).toMatchObject({
        task: "Building MCP tools",
        percentage: 75,
        description: "3 of 4 tools done",
      });
    });

    it("should return error for unknown session", async () => {
      mockGetAgentBySession.mockReturnValue(undefined);
      const tool = server.getTool("report_progress")!;
      const result = await tool.handler(
        { task: "Test", percentage: 50 },
        fakeExtra("unknown-session"),
      );

      expect(result).toEqual({
        content: [{ type: "text", text: expect.stringContaining("Unknown agent") }],
        isError: true,
      });
    });
  });

  // ========================================================================
  // announce
  // ========================================================================
  describe("announce", () => {
    it("should be registered as a tool", () => {
      expect(server.getTool("announce")).toBeDefined();
    });

    it("should store announcement in messages table", async () => {
      const tool = server.getTool("announce")!;
      const result = (await tool.handler(
        {
          type: "completion",
          title: "Feature X done",
          body: "All tests passing",
          beadId: "adj-42",
        },
        fakeExtra(),
      )) as { content: Array<{ text: string }> };

      // Verify response contains messageId and timestamp
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.messageId).toBeDefined();
      expect(parsed.timestamp).toBeDefined();

      // Verify it was stored in DB
      const messages = store.getMessages({ agentId: "agent-1" });
      expect(messages).toHaveLength(1);
      expect(messages[0]!.role).toBe("announcement");
      expect(messages[0]!.body).toContain("[COMPLETION]");
      expect(messages[0]!.body).toContain("Feature X done");
      expect(messages[0]!.body).toContain("All tests passing");
      expect(messages[0]!.eventType).toBe("announcement");
      expect(messages[0]!.metadata).toMatchObject({
        announcementType: "completion",
        beadId: "adj-42",
      });
    });

    it("should broadcast announcement via WebSocket", async () => {
      const tool = server.getTool("announce")!;
      await tool.handler(
        { type: "blocker", title: "API down", body: "External service unavailable" },
        fakeExtra(),
      );

      expect(mockWsBroadcast).toHaveBeenCalledTimes(1);
      const broadcast = mockWsBroadcast.mock.calls[0]![0];
      expect(broadcast.type).toBe("message");
      expect(broadcast.from).toBe("agent-1");
      expect(broadcast.body).toContain("[BLOCKER]");
      expect(broadcast.body).toContain("API down");
      expect(broadcast.metadata).toMatchObject({
        announcementType: "blocker",
      });
    });

    it("should return error for unknown session", async () => {
      mockGetAgentBySession.mockReturnValue(undefined);
      const tool = server.getTool("announce")!;
      const result = await tool.handler(
        { type: "question", title: "Test", body: "Body" },
        fakeExtra("unknown-session"),
      );

      expect(result).toEqual({
        content: [{ type: "text", text: expect.stringContaining("Unknown agent") }],
        isError: true,
      });
    });
  });

  // ========================================================================
  // getAgentStatuses
  // ========================================================================
  describe("getAgentStatuses", () => {
    it("should return current status map", async () => {
      const tool = server.getTool("set_status")!;

      // Register two agents
      mockGetAgentBySession.mockReturnValue("agent-1");
      await tool.handler({ status: "working", task: "A" }, fakeExtra("s1"));

      mockGetAgentBySession.mockReturnValue("agent-2");
      await tool.handler({ status: "blocked", task: "B" }, fakeExtra("s2"));

      const statuses = getAgentStatuses();
      expect(statuses.size).toBe(2);
      expect(statuses.get("agent-1")?.status).toBe("working");
      expect(statuses.get("agent-2")?.status).toBe("blocked");
    });

    it("should return empty map when no statuses set", () => {
      const statuses = getAgentStatuses();
      expect(statuses.size).toBe(0);
    });
  });
});
