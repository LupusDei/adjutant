import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MessageStore } from "../../src/services/message-store.js";

// Mock logger before imports
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// ============================================================================
// Mock setup
// ============================================================================

// Capture tool registrations so we can invoke them in tests
const registeredTools = new Map<string, { schema: unknown; handler: Function }>();

const mockServer = {
  tool: vi.fn((name: string, schema: unknown, handler: Function) => {
    registeredTools.set(name, { schema, handler });
  }),
} as unknown as McpServer;

// Mock mcp-server module
const mockGetConnectedAgents = vi.fn();
vi.mock("../../src/services/mcp-server.js", () => ({
  getConnectedAgents: (...args: unknown[]) => mockGetConnectedAgents(...args),
}));

// Mock agents-service module
const mockGetAgents = vi.fn();
vi.mock("../../src/services/agents-service.js", () => ({
  getAgents: (...args: unknown[]) => mockGetAgents(...args),
}));

// Mock bd-client module
const mockExecBd = vi.fn();
vi.mock("../../src/services/bd-client.js", () => ({
  execBd: (...args: unknown[]) => mockExecBd(...args),
}));

// Mock event-bus
vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: vi.fn(() => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() })),
  resetEventBus: vi.fn(),
}));

// Create a mock message store
function createMockStore(overrides: Partial<MessageStore> = {}): MessageStore {
  return {
    insertMessage: vi.fn() as MessageStore["insertMessage"],
    getMessage: vi.fn() as MessageStore["getMessage"],
    getMessages: vi.fn().mockReturnValue([]) as MessageStore["getMessages"],
    markRead: vi.fn() as MessageStore["markRead"],
    markAllRead: vi.fn() as MessageStore["markAllRead"],
    searchMessages: vi.fn().mockReturnValue([]) as MessageStore["searchMessages"],
    getUnreadCounts: vi.fn().mockReturnValue([]) as MessageStore["getUnreadCounts"],
    getThreads: vi.fn() as MessageStore["getThreads"],
    ...overrides,
  };
}

// Import after mocks are set up
import { registerQueryTools } from "../../src/services/mcp-tools/queries.js";

// ============================================================================
// Helper to invoke a registered tool
// ============================================================================

async function invokeTool(name: string, args: Record<string, unknown> = {}) {
  const tool = registeredTools.get(name);
  if (!tool) throw new Error(`Tool "${name}" not registered`);
  return tool.handler(args);
}

// ============================================================================
// Tests
// ============================================================================

describe("Query MCP Tools", () => {
  let mockStore: MessageStore;

  beforeEach(() => {
    vi.clearAllMocks();
    registeredTools.clear();
    mockStore = createMockStore();
    registerQueryTools(mockServer, mockStore);
  });

  describe("registerQueryTools", () => {
    it("should register all three query tools", () => {
      expect(registeredTools.has("list_agents")).toBe(true);
      expect(registeredTools.has("get_project_state")).toBe(true);
      expect(registeredTools.has("search_messages")).toBe(true);
    });
  });

  // ==========================================================================
  // list_agents
  // ==========================================================================

  describe("list_agents", () => {
    it("should return connected MCP agents", async () => {
      mockGetConnectedAgents.mockReturnValue([
        {
          agentId: "researcher",
          sessionId: "sess-1",
          connectedAt: new Date("2025-01-15T10:00:00Z"),
        },
        {
          agentId: "builder",
          sessionId: "sess-2",
          connectedAt: new Date("2025-01-15T10:05:00Z"),
        },
      ]);
      mockGetAgents.mockResolvedValue({
        success: true,
        data: [
          { id: "researcher", name: "researcher", status: "working", currentTask: "Fixing bug" },
          { id: "builder", name: "builder", status: "idle" },
          { id: "offline-agent", name: "offline-agent", status: "offline" },
        ],
      });

      const result = await invokeTool("list_agents", { status: "all" });

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe("text");
      const data = JSON.parse(result.content[0].text);
      // Should include all agents (connected + from agents-service)
      expect(data.agents.length).toBeGreaterThanOrEqual(2);
    });

    it("should filter agents by active status", async () => {
      mockGetConnectedAgents.mockReturnValue([
        {
          agentId: "researcher",
          sessionId: "sess-1",
          connectedAt: new Date("2025-01-15T10:00:00Z"),
        },
      ]);
      mockGetAgents.mockResolvedValue({
        success: true,
        data: [
          { id: "researcher", name: "researcher", status: "working", currentTask: "Fixing bug" },
          { id: "idle-agent", name: "idle-agent", status: "idle" },
          { id: "offline-agent", name: "offline-agent", status: "offline" },
        ],
      });

      const result = await invokeTool("list_agents", { status: "active" });
      const data = JSON.parse(result.content[0].text);

      // "active" means working or connected
      const statuses = data.agents.map((a: { status: string }) => a.status);
      expect(statuses).not.toContain("offline");
      expect(statuses).not.toContain("idle");
    });

    it("should filter agents by idle status", async () => {
      mockGetConnectedAgents.mockReturnValue([]);
      mockGetAgents.mockResolvedValue({
        success: true,
        data: [
          { id: "researcher", name: "researcher", status: "working" },
          { id: "idle-agent", name: "idle-agent", status: "idle" },
          { id: "offline-agent", name: "offline-agent", status: "offline" },
        ],
      });

      const result = await invokeTool("list_agents", { status: "idle" });
      const data = JSON.parse(result.content[0].text);

      const statuses = data.agents.map((a: { status: string }) => a.status);
      for (const s of statuses) {
        expect(s).toBe("idle");
      }
    });

    it("should merge MCP connection data with agent service data", async () => {
      mockGetConnectedAgents.mockReturnValue([
        {
          agentId: "researcher",
          sessionId: "sess-1",
          connectedAt: new Date("2025-01-15T10:00:00Z"),
        },
      ]);
      mockGetAgents.mockResolvedValue({
        success: true,
        data: [
          { id: "researcher", name: "researcher", status: "working", currentTask: "Fixing bug" },
        ],
      });

      const result = await invokeTool("list_agents", { status: "all" });
      const data = JSON.parse(result.content[0].text);

      const researcher = data.agents.find((a: { agentId: string }) => a.agentId === "researcher");
      expect(researcher).toBeDefined();
      expect(researcher.sessionId).toBe("sess-1");
      expect(researcher.currentTask).toBe("Fixing bug");
    });

    it("should handle agents-service failure gracefully", async () => {
      mockGetConnectedAgents.mockReturnValue([
        {
          agentId: "researcher",
          sessionId: "sess-1",
          connectedAt: new Date("2025-01-15T10:00:00Z"),
        },
      ]);
      mockGetAgents.mockResolvedValue({
        success: false,
        error: { code: "AGENTS_ERROR", message: "Failed" },
      });

      const result = await invokeTool("list_agents", { status: "all" });
      const data = JSON.parse(result.content[0].text);

      // Should still return connected agents from MCP even if agents-service fails
      expect(data.agents.length).toBeGreaterThanOrEqual(1);
      expect(data.agents[0].agentId).toBe("researcher");
    });
  });

  // ==========================================================================
  // get_project_state
  // ==========================================================================

  describe("get_project_state", () => {
    it("should return aggregate project state", async () => {
      mockGetConnectedAgents.mockReturnValue([
        { agentId: "researcher", sessionId: "sess-1", connectedAt: new Date() },
        { agentId: "builder", sessionId: "sess-2", connectedAt: new Date() },
      ]);

      mockExecBd.mockResolvedValue({
        success: true,
        data: [
          { id: "bead-1", status: "open", title: "Task 1" },
          { id: "bead-2", status: "open", title: "Task 2" },
          { id: "bead-3", status: "closed", title: "Task 3" },
        ],
      });

      (mockStore.getMessages as ReturnType<typeof vi.fn>).mockReturnValue(
        Array(5).fill({
          id: "msg-1",
          agentId: "researcher",
          role: "agent",
          body: "test",
          createdAt: new Date().toISOString(),
        }),
      );

      (mockStore.getUnreadCounts as ReturnType<typeof vi.fn>).mockReturnValue([
        { agentId: "researcher", count: 3 },
        { agentId: "builder", count: 1 },
      ]);

      const result = await invokeTool("get_project_state");
      const data = JSON.parse(result.content[0].text);

      expect(data.connectedAgents).toBe(2);
      expect(data.openBeads).toBe(2);
      expect(data.recentMessages).toBe(5);
      expect(data.unreadCounts).toEqual([
        { agentId: "researcher", count: 3 },
        { agentId: "builder", count: 1 },
      ]);
    });

    it("should handle bd-client failure gracefully", async () => {
      mockGetConnectedAgents.mockReturnValue([]);
      mockExecBd.mockResolvedValue({
        success: false,
        error: { code: "COMMAND_FAILED", message: "bd not found" },
      });
      (mockStore.getMessages as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockStore.getUnreadCounts as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const result = await invokeTool("get_project_state");
      const data = JSON.parse(result.content[0].text);

      expect(data.connectedAgents).toBe(0);
      expect(data.openBeads).toBe(0);
      expect(data.recentMessages).toBe(0);
    });

    it("should count only open beads", async () => {
      mockGetConnectedAgents.mockReturnValue([]);
      mockExecBd.mockResolvedValue({
        success: true,
        data: [
          { id: "b-1", status: "open", title: "Open" },
          { id: "b-2", status: "closed", title: "Closed" },
          { id: "b-3", status: "in_progress", title: "In Progress" },
        ],
      });
      (mockStore.getMessages as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (mockStore.getUnreadCounts as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const result = await invokeTool("get_project_state");
      const data = JSON.parse(result.content[0].text);

      // open + in_progress should count as open beads
      expect(data.openBeads).toBe(2);
    });
  });

  // ==========================================================================
  // search_messages
  // ==========================================================================

  describe("search_messages", () => {
    it("should search messages using FTS5", async () => {
      const mockMessages = [
        {
          id: "msg-1",
          agentId: "researcher",
          role: "agent" as const,
          body: "Found a bug in authentication",
          sessionId: null,
          recipient: null,
          metadata: null,
          deliveryStatus: "sent" as const,
          eventType: null,
          threadId: null,
          createdAt: "2025-01-15T10:00:00Z",
          updatedAt: "2025-01-15T10:00:00Z",
        },
      ];
      (mockStore.searchMessages as ReturnType<typeof vi.fn>).mockReturnValue(mockMessages);

      const result = await invokeTool("search_messages", {
        query: "authentication bug",
      });
      const data = JSON.parse(result.content[0].text);

      expect(mockStore.searchMessages).toHaveBeenCalledWith("authentication bug", {
        agentId: undefined,
        limit: 20,
      });
      expect(data.results).toHaveLength(1);
      expect(data.count).toBe(1);
      expect(data.results[0].body).toBe("Found a bug in authentication");
    });

    it("should filter search by agent ID", async () => {
      (mockStore.searchMessages as ReturnType<typeof vi.fn>).mockReturnValue([]);

      await invokeTool("search_messages", {
        query: "status update",
        agentId: "builder",
      });

      expect(mockStore.searchMessages).toHaveBeenCalledWith("status update", {
        agentId: "builder",
        limit: 20,
      });
    });

    it("should respect custom limit", async () => {
      (mockStore.searchMessages as ReturnType<typeof vi.fn>).mockReturnValue([]);

      await invokeTool("search_messages", {
        query: "test",
        limit: 5,
      });

      expect(mockStore.searchMessages).toHaveBeenCalledWith("test", {
        agentId: undefined,
        limit: 5,
      });
    });

    it("should return results with count", async () => {
      const messages = Array(3).fill(null).map((_, i) => ({
        id: `msg-${i}`,
        agentId: "researcher",
        role: "agent" as const,
        body: `Message ${i}`,
        sessionId: null,
        recipient: null,
        metadata: null,
        deliveryStatus: "sent" as const,
        eventType: null,
        threadId: null,
        createdAt: `2025-01-15T1${i}:00:00Z`,
        updatedAt: `2025-01-15T1${i}:00:00Z`,
      }));
      (mockStore.searchMessages as ReturnType<typeof vi.fn>).mockReturnValue(messages);

      const result = await invokeTool("search_messages", { query: "Message" });
      const data = JSON.parse(result.content[0].text);

      expect(data.results).toHaveLength(3);
      expect(data.count).toBe(3);
    });

    it("should handle empty search results", async () => {
      (mockStore.searchMessages as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const result = await invokeTool("search_messages", { query: "nonexistent" });
      const data = JSON.parse(result.content[0].text);

      expect(data.results).toHaveLength(0);
      expect(data.count).toBe(0);
    });
  });
});
