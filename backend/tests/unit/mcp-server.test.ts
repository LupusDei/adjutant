import { describe, it, expect, vi, beforeEach } from "vitest";

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

// Mock MCP SDK
const {
  mockConnect,
  mockClose,
  sessionIdState,
  createdTransports,
} = vi.hoisted(() => {
  const mockConnect = vi.fn().mockResolvedValue(undefined);
  const mockClose = vi.fn().mockResolvedValue(undefined);
  const sessionIdState = { counter: 0 };
  const createdTransports: Array<{
    sessionId: string | undefined;
    onclose?: () => void;
    _onsessioninitialized?: (sessionId: string) => void;
    _onsessionclosed?: (sessionId: string) => void;
    handleRequest: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }> = [];
  return { mockConnect, mockClose, sessionIdState, createdTransports };
});

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: vi.fn(function () {
    return {
      connect: mockConnect,
      close: mockClose,
      server: {},
    };
  }),
}));

vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation(function (
    options?: {
      sessionIdGenerator?: () => string;
      onsessioninitialized?: (sessionId: string) => void;
      onsessionclosed?: (sessionId: string) => void;
    },
  ) {
    sessionIdState.counter++;
    const transport = {
      sessionId: undefined as string | undefined,
      onclose: undefined as (() => void) | undefined,
      _onsessioninitialized: options?.onsessioninitialized,
      _onsessionclosed: options?.onsessionclosed,
      handleRequest: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
    };
    createdTransports.push(transport);
    return transport;
  }),
}));

import {
  createMcpServer,
  resetMcpServer,
  getConnectedAgents,
  getAgentBySession,
  getTransportBySession,
  disconnectAgent,
  resolveAgentId,
  createSessionTransport,
  setToolRegistrar,
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

    it("should call toolRegistrar when set", () => {
      const registrar = vi.fn();
      setToolRegistrar(registrar);
      const server = createMcpServer();
      expect(registrar).toHaveBeenCalledWith(server);
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

  describe("createSessionTransport", () => {
    it("should create a transport and connect server to it", async () => {
      await createSessionTransport("researcher");

      expect(createdTransports).toHaveLength(1);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it("should configure transport with sessionIdGenerator", async () => {
      await createSessionTransport("researcher");

      const { StreamableHTTPServerTransport } = await import(
        "@modelcontextprotocol/sdk/server/streamableHttp.js"
      );
      expect(StreamableHTTPServerTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionIdGenerator: expect.any(Function),
        }),
      );
    });

    it("should configure transport with onsessioninitialized callback", async () => {
      await createSessionTransport("researcher");

      const transport = createdTransports[0]!;
      expect(transport._onsessioninitialized).toBeTypeOf("function");
    });

    it("should configure transport with onsessionclosed callback", async () => {
      await createSessionTransport("researcher");

      const transport = createdTransports[0]!;
      expect(transport._onsessionclosed).toBeTypeOf("function");
    });

    it("should return transport and server", async () => {
      const result = await createSessionTransport("researcher");

      expect(result.transport).toBeDefined();
      expect(result.server).toBeDefined();
    });
  });

  describe("session lifecycle via onsessioninitialized", () => {
    it("should start with no connected agents", () => {
      expect(getConnectedAgents()).toHaveLength(0);
    });

    it("should track agent after onsessioninitialized fires", async () => {
      await createSessionTransport("researcher");

      const transport = createdTransports[0]!;
      // Simulate the SDK calling onsessioninitialized after processing initialize request
      transport.sessionId = "session-abc";
      transport._onsessioninitialized!("session-abc");

      const agents = getConnectedAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0]!.agentId).toBe("researcher");
      expect(agents[0]!.sessionId).toBe("session-abc");
    });

    it("should record connection timestamp", async () => {
      const before = new Date();
      await createSessionTransport("researcher");

      const transport = createdTransports[0]!;
      transport.sessionId = "session-abc";
      transport._onsessioninitialized!("session-abc");
      const after = new Date();

      const agents = getConnectedAgents();
      expect(agents[0]!.connectedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(agents[0]!.connectedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("should emit mcp:agent_connected event", async () => {
      const bus = getEventBus();
      await createSessionTransport("researcher");

      const transport = createdTransports[0]!;
      transport.sessionId = "session-abc";
      transport._onsessioninitialized!("session-abc");

      expect(bus.emit).toHaveBeenCalledWith(
        "mcp:agent_connected",
        expect.objectContaining({
          agentId: "researcher",
          sessionId: "session-abc",
        }),
      );
    });

    it("should track multiple agents independently", async () => {
      await createSessionTransport("researcher");
      await createSessionTransport("builder");

      createdTransports[0]!.sessionId = "session-1";
      createdTransports[0]!._onsessioninitialized!("session-1");
      createdTransports[1]!.sessionId = "session-2";
      createdTransports[1]!._onsessioninitialized!("session-2");

      const agents = getConnectedAgents();
      expect(agents).toHaveLength(2);
      const ids = agents.map((a) => a.agentId);
      expect(ids).toContain("researcher");
      expect(ids).toContain("builder");
    });
  });

  describe("session cleanup via onsessionclosed", () => {
    it("should remove agent when onsessionclosed fires", async () => {
      await createSessionTransport("researcher");

      const transport = createdTransports[0]!;
      transport.sessionId = "session-abc";
      transport._onsessioninitialized!("session-abc");
      expect(getConnectedAgents()).toHaveLength(1);

      // Simulate DELETE request triggering onsessionclosed
      transport._onsessionclosed!("session-abc");

      expect(getConnectedAgents()).toHaveLength(0);
    });

    it("should emit mcp:agent_disconnected on session close", async () => {
      const bus = getEventBus();
      await createSessionTransport("researcher");

      const transport = createdTransports[0]!;
      transport.sessionId = "session-abc";
      transport._onsessioninitialized!("session-abc");
      vi.clearAllMocks();

      transport._onsessionclosed!("session-abc");

      expect(bus.emit).toHaveBeenCalledWith(
        "mcp:agent_disconnected",
        expect.objectContaining({
          agentId: "researcher",
          sessionId: "session-abc",
        }),
      );
    });

    it("should only remove the specified session", async () => {
      await createSessionTransport("researcher");
      await createSessionTransport("builder");

      createdTransports[0]!.sessionId = "session-1";
      createdTransports[0]!._onsessioninitialized!("session-1");
      createdTransports[1]!.sessionId = "session-2";
      createdTransports[1]!._onsessioninitialized!("session-2");

      createdTransports[0]!._onsessionclosed!("session-1");

      const agents = getConnectedAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0]!.agentId).toBe("builder");
    });

    it("should handle onsessionclosed for unknown session gracefully", async () => {
      await createSessionTransport("researcher");
      const transport = createdTransports[0]!;
      expect(() => transport._onsessionclosed!("nonexistent")).not.toThrow();
    });
  });

  describe("disconnectAgent (manual)", () => {
    it("should remove agent from connections", async () => {
      await createSessionTransport("researcher");
      const transport = createdTransports[0]!;
      transport.sessionId = "session-abc";
      transport._onsessioninitialized!("session-abc");

      disconnectAgent("session-abc");
      expect(getConnectedAgents()).toHaveLength(0);
    });

    it("should emit mcp:agent_disconnected event", async () => {
      const bus = getEventBus();
      await createSessionTransport("researcher");
      const transport = createdTransports[0]!;
      transport.sessionId = "session-abc";
      transport._onsessioninitialized!("session-abc");
      vi.clearAllMocks();

      disconnectAgent("session-abc");

      expect(bus.emit).toHaveBeenCalledWith(
        "mcp:agent_disconnected",
        expect.objectContaining({
          agentId: "researcher",
          sessionId: "session-abc",
        }),
      );
    });

    it("should handle disconnect of unknown session gracefully", () => {
      expect(() => disconnectAgent("nonexistent")).not.toThrow();
    });
  });

  describe("getAgentBySession", () => {
    it("should return agentId for known session", async () => {
      await createSessionTransport("researcher");
      const transport = createdTransports[0]!;
      transport.sessionId = "session-abc";
      transport._onsessioninitialized!("session-abc");

      expect(getAgentBySession("session-abc")).toBe("researcher");
    });

    it("should return undefined for unknown session", () => {
      expect(getAgentBySession("nonexistent")).toBeUndefined();
    });
  });

  describe("getTransportBySession", () => {
    it("should return transport for known session", async () => {
      await createSessionTransport("researcher");
      const transport = createdTransports[0]!;
      transport.sessionId = "session-abc";
      transport._onsessioninitialized!("session-abc");

      expect(getTransportBySession("session-abc")).toBe(transport);
    });

    it("should return undefined for unknown session", () => {
      expect(getTransportBySession("nonexistent")).toBeUndefined();
    });
  });

  describe("transport onclose cleanup", () => {
    it("should set onclose handler on transport", async () => {
      await createSessionTransport("researcher");
      const transport = createdTransports[0]!;
      expect(transport.onclose).toBeTypeOf("function");
    });

    it("should disconnect agent when transport onclose fires", async () => {
      await createSessionTransport("researcher");
      const transport = createdTransports[0]!;
      transport.sessionId = "session-abc";
      transport._onsessioninitialized!("session-abc");

      expect(getConnectedAgents()).toHaveLength(1);
      transport.onclose!();
      expect(getConnectedAgents()).toHaveLength(0);
    });

    it("should not throw if onclose fires after manual disconnect", async () => {
      await createSessionTransport("researcher");
      const transport = createdTransports[0]!;
      transport.sessionId = "session-abc";
      transport._onsessioninitialized!("session-abc");

      disconnectAgent("session-abc");
      expect(() => transport.onclose!()).not.toThrow();
    });
  });
});
