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

// Mock MCP SDK - use vi.hoisted so all variables are available in vi.mock factories
const {
  mockConnect,
  mockStart,
  sessionIdState,
  createdTransports,
} = vi.hoisted(() => {
  const mockConnect = vi.fn().mockResolvedValue(undefined);
  const mockStart = vi.fn().mockResolvedValue(undefined);
  const sessionIdState = { counter: 0 };
  const createdTransports: Array<{ sessionId: string; onclose?: () => void }> = [];
  return { mockConnect, mockStart, sessionIdState, createdTransports };
});

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: vi.fn(() => ({
    connect: mockConnect,
    close: vi.fn().mockResolvedValue(undefined),
    server: {},
  })),
}));

vi.mock("@modelcontextprotocol/sdk/server/sse.js", () => ({
  SSEServerTransport: vi.fn().mockImplementation(() => {
    sessionIdState.counter++;
    const transport = {
      sessionId: `session-${sessionIdState.counter}`,
      start: mockStart,
      close: vi.fn().mockResolvedValue(undefined),
      onclose: undefined as (() => void) | undefined,
    };
    createdTransports.push(transport);
    return transport;
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
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getEventBus } from "../../src/services/event-bus.js";

const MockedMcpServer = vi.mocked(McpServer);

describe("MCP Server", () => {
  beforeEach(() => {
    resetMcpServer();
    sessionIdState.counter = 0;
    createdTransports.length = 0;
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
      expect(MockedMcpServer).toHaveBeenCalledWith(
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

  describe("transport onclose cleanup", () => {
    it("should set onclose handler on transport", async () => {
      await connectAgent("researcher", createMockResponse());

      const transport = createdTransports[0]!;
      expect(transport.onclose).toBeTypeOf("function");
    });

    it("should disconnect agent when transport onclose fires", async () => {
      const connection = await connectAgent("researcher", createMockResponse());

      expect(getConnectedAgents()).toHaveLength(1);

      // Simulate transport close (network drop, agent crash, etc.)
      const transport = createdTransports[0]!;
      transport.onclose!();

      expect(getConnectedAgents()).toHaveLength(0);
    });

    it("should emit mcp:agent_disconnected when transport closes", async () => {
      const bus = getEventBus();
      await connectAgent("researcher", createMockResponse());

      vi.clearAllMocks();

      const transport = createdTransports[0]!;
      transport.onclose!();

      expect(bus.emit).toHaveBeenCalledWith(
        "mcp:agent_disconnected",
        expect.objectContaining({ agentId: "researcher" }),
      );
    });

    it("should not throw if onclose fires after manual disconnect", async () => {
      const connection = await connectAgent("researcher", createMockResponse());
      disconnectAgent(connection.sessionId);

      // Transport close fires after manual disconnect — should be a no-op
      const transport = createdTransports[0]!;
      expect(() => transport.onclose!()).not.toThrow();
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
