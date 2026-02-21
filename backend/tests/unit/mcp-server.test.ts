import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ServerResponse } from "node:http";

// Mock logger before imports
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock event-bus
const { mockBus } = vi.hoisted(() => {
  const mockBus = {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
  return { mockBus };
});

vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: vi.fn(() => mockBus),
  resetEventBus: vi.fn(),
}));

// Mock MCP SDK - use vi.hoisted so mocks are available in vi.mock factories
const { mockConnect, mockClose, MockMcpServer, mockStart } = vi.hoisted(() => {
  const mockConnect = vi.fn().mockResolvedValue(undefined);
  const mockClose = vi.fn().mockResolvedValue(undefined);
  const MockMcpServer = vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    close: mockClose,
    server: {},
  }));
  const mockStart = vi.fn().mockResolvedValue(undefined);
  return { mockConnect, mockClose, MockMcpServer, mockStart };
});

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: MockMcpServer,
}));

let sessionIdCounter = 0;
vi.mock("@modelcontextprotocol/sdk/server/sse.js", () => ({
  SSEServerTransport: vi.fn().mockImplementation(() => {
    sessionIdCounter++;
    return {
      sessionId: `session-${sessionIdCounter}`,
      start: mockStart,
      close: vi.fn().mockResolvedValue(undefined),
      onclose: undefined,
    };
  }),
}));

import {
  createMcpServer,
  getMcpServer,
  resetMcpServer,
  getConnectedAgents,
  connectAgent,
  disconnectAgent,
  resolveAgentId,
} from "../../src/services/mcp-server.js";
import { getEventBus } from "../../src/services/event-bus.js";

describe("MCP Server", () => {
  beforeEach(() => {
    resetMcpServer();
    sessionIdCounter = 0;
    vi.clearAllMocks();
  });

  describe("createMcpServer", () => {
    it("should create an MCP server instance", () => {
      const server = createMcpServer();
      expect(server).toBeDefined();
      expect(server.connect).toBeDefined();
    });

    it("should configure server with name 'adjutant'", () => {
      createMcpServer();
      expect(MockMcpServer).toHaveBeenCalledWith(
        expect.objectContaining({ name: "adjutant" }),
        expect.anything(),
      );
    });
  });

  describe("getMcpServer (singleton)", () => {
    it("should return the same instance on repeated calls", () => {
      const server1 = getMcpServer();
      const server2 = getMcpServer();
      expect(server1).toBe(server2);
    });

    it("should return a new instance after reset", () => {
      const server1 = getMcpServer();
      resetMcpServer();
      const server2 = getMcpServer();
      expect(server1).not.toBe(server2);
    });
  });

  describe("resolveAgentId", () => {
    it("should resolve from query param agentId", () => {
      const id = resolveAgentId({ agentId: "researcher" }, {});
      expect(id).toBe("researcher");
    });

    it("should resolve from X-Agent-Id header", () => {
      const id = resolveAgentId({}, { "x-agent-id": "builder" });
      expect(id).toBe("builder");
    });

    it("should prefer query param over header", () => {
      const id = resolveAgentId(
        { agentId: "from-query" },
        { "x-agent-id": "from-header" },
      );
      expect(id).toBe("from-query");
    });

    it("should generate fallback ID when no identity provided", () => {
      const id = resolveAgentId({}, {});
      expect(id).toMatch(/^unknown-agent-/);
    });

    it("should generate unique fallback IDs", () => {
      const id1 = resolveAgentId({}, {});
      const id2 = resolveAgentId({}, {});
      expect(id1).not.toBe(id2);
    });
  });

  describe("connection tracking", () => {
    it("should start with no connected agents", () => {
      const agents = getConnectedAgents();
      expect(agents).toHaveLength(0);
    });

    it("should track a connected agent", async () => {
      const mockRes = createMockResponse();
      await connectAgent("researcher", mockRes);

      const agents = getConnectedAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0]!.agentId).toBe("researcher");
    });

    it("should record session ID from transport", async () => {
      const mockRes = createMockResponse();
      const connection = await connectAgent("researcher", mockRes);

      expect(connection.sessionId).toMatch(/^session-/);
    });

    it("should record connection timestamp", async () => {
      const before = new Date();
      const mockRes = createMockResponse();
      const connection = await connectAgent("researcher", mockRes);
      const after = new Date();

      expect(connection.connectedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(connection.connectedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("should track multiple connected agents", async () => {
      await connectAgent("researcher", createMockResponse());
      await connectAgent("builder", createMockResponse());

      const agents = getConnectedAgents();
      expect(agents).toHaveLength(2);
      const ids = agents.map((a) => a.agentId);
      expect(ids).toContain("researcher");
      expect(ids).toContain("builder");
    });

    it("should remove agent on disconnect", async () => {
      const connection = await connectAgent("researcher", createMockResponse());
      disconnectAgent(connection.sessionId);

      const agents = getConnectedAgents();
      expect(agents).toHaveLength(0);
    });

    it("should only remove the specified agent", async () => {
      const conn1 = await connectAgent("researcher", createMockResponse());
      await connectAgent("builder", createMockResponse());

      disconnectAgent(conn1.sessionId);

      const agents = getConnectedAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0]!.agentId).toBe("builder");
    });

    it("should handle disconnect of unknown session gracefully", () => {
      expect(() => disconnectAgent("nonexistent")).not.toThrow();
    });
  });

  describe("EventBus integration", () => {
    it("should emit mcp:agent_connected on connect", async () => {
      const bus = getEventBus();
      await connectAgent("researcher", createMockResponse());

      expect(bus.emit).toHaveBeenCalledWith(
        "mcp:agent_connected",
        expect.objectContaining({
          agentId: "researcher",
          sessionId: expect.stringMatching(/^session-/),
        }),
      );
    });

    it("should emit mcp:agent_disconnected on disconnect", async () => {
      const bus = getEventBus();
      const connection = await connectAgent("researcher", createMockResponse());

      vi.clearAllMocks();
      disconnectAgent(connection.sessionId);

      expect(bus.emit).toHaveBeenCalledWith(
        "mcp:agent_disconnected",
        expect.objectContaining({
          agentId: "researcher",
          sessionId: connection.sessionId,
        }),
      );
    });
  });

  describe("SSE transport creation", () => {
    it("should create SSE transport and start it", async () => {
      const mockRes = createMockResponse();
      await connectAgent("researcher", mockRes);

      expect(mockStart).toHaveBeenCalled();
    });

    it("should connect transport to the MCP server", async () => {
      await connectAgent("researcher", createMockResponse());

      expect(mockConnect).toHaveBeenCalled();
    });
  });
});

/**
 * Create a mock ServerResponse for testing.
 */
function createMockResponse(): ServerResponse {
  return {
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  } as unknown as ServerResponse;
}
