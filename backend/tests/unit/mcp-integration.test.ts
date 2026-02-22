/**
 * Integration smoke test for MCP Streamable HTTP migration.
 *
 * Verifies the full initialization → tool call → session termination flow
 * using mocked transports to test route + service integration.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
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

// Mock SDK — capture transport options so we can trigger callbacks
const { sessionIdState, createdTransports, mockConnect } = vi.hoisted(() => {
  const sessionIdState = { counter: 0 };
  const createdTransports: Array<{
    sessionId: string | undefined;
    onclose?: () => void;
    _onsessioninitialized?: (sessionId: string) => void;
    _onsessionclosed?: (sessionId: string) => void;
    handleRequest: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
  }> = [];
  const mockConnect = vi.fn().mockResolvedValue(undefined);
  return { sessionIdState, createdTransports, mockConnect };
});

// Mock SDK types — realistic isInitializeRequest
vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
  isInitializeRequest: (value: unknown) => {
    if (typeof value !== "object" || value === null) return false;
    const obj = value as Record<string, unknown>;
    return obj["method"] === "initialize" && obj["jsonrpc"] === "2.0";
  },
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: vi.fn(function () {
    return {
      connect: mockConnect,
      close: vi.fn().mockResolvedValue(undefined),
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
    const sessionId = `smoke-session-${sessionIdState.counter}`;
    const transport = {
      sessionId: undefined as string | undefined,
      onclose: undefined as (() => void) | undefined,
      _onsessioninitialized: options?.onsessioninitialized,
      _onsessionclosed: options?.onsessionclosed,
      handleRequest: vi.fn().mockImplementation(async () => {
        // Simulate the transport setting session ID and firing callback
        // on first call (initialization)
        if (!transport.sessionId && transport._onsessioninitialized) {
          transport.sessionId = sessionId;
          transport._onsessioninitialized(sessionId);
        }
      }),
      close: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
    };
    createdTransports.push(transport);
    return transport;
  }),
}));

import {
  resetMcpServer,
  getConnectedAgents,
  getAgentBySession,
} from "../../src/services/mcp-server.js";
import { mcpRouter } from "../../src/routes/mcp.js";

describe("MCP Streamable HTTP Integration", () => {
  beforeEach(() => {
    resetMcpServer();
    sessionIdState.counter = 0;
    createdTransports.length = 0;
    vi.clearAllMocks();
  });

  it("full lifecycle: initialize → tool call → disconnect", async () => {
    // Step 1: Agent sends initialization POST (no session ID)
    const initReq = createMockReq({
      method: "POST",
      headers: { "x-agent-id": "smoke-agent" },
      body: { jsonrpc: "2.0", method: "initialize", id: 1 },
    });
    const initRes = createMockRes();

    const postHandler = findRouteHandler(mcpRouter, "post", "/");
    await postHandler!(initReq, initRes, vi.fn());

    // Verify agent is tracked
    expect(getConnectedAgents()).toHaveLength(1);
    expect(getAgentBySession("smoke-session-1")).toBe("smoke-agent");

    // Step 2: Agent sends tool call POST (with session ID)
    const toolReq = createMockReq({
      method: "POST",
      headers: { "mcp-session-id": "smoke-session-1" },
      body: { jsonrpc: "2.0", method: "tools/call", id: 2 },
    });
    const toolRes = createMockRes();

    await postHandler!(toolReq, toolRes, vi.fn());

    // Verify routed to existing transport
    const transport = createdTransports[0]!;
    expect(transport.handleRequest).toHaveBeenCalledTimes(2);

    // Step 3: Agent sends DELETE (session termination)
    const deleteReq = createMockReq({
      method: "DELETE",
      headers: { "mcp-session-id": "smoke-session-1" },
    });
    const deleteRes = createMockRes();

    // Simulate DELETE triggering onsessionclosed
    transport.handleRequest.mockImplementationOnce(async () => {
      transport._onsessionclosed!("smoke-session-1");
    });

    const deleteHandler = findRouteHandler(mcpRouter, "delete", "/");
    await deleteHandler!(deleteReq, deleteRes, vi.fn());

    // Verify agent is cleaned up
    expect(getConnectedAgents()).toHaveLength(0);
    expect(getAgentBySession("smoke-session-1")).toBeUndefined();

    // Verify EventBus events fired
    expect(mockBus.emit).toHaveBeenCalledWith(
      "mcp:agent_connected",
      expect.objectContaining({ agentId: "smoke-agent" }),
    );
    expect(mockBus.emit).toHaveBeenCalledWith(
      "mcp:agent_disconnected",
      expect.objectContaining({ agentId: "smoke-agent" }),
    );
  });

  it("multiple agents can have independent sessions", async () => {
    const postHandler = findRouteHandler(mcpRouter, "post", "/");

    // Agent 1 connects
    const req1 = createMockReq({
      method: "POST",
      headers: { "x-agent-id": "agent-alpha" },
      body: { jsonrpc: "2.0", method: "initialize", id: 1 },
    });
    await postHandler!(req1, createMockRes(), vi.fn());

    // Agent 2 connects
    const req2 = createMockReq({
      method: "POST",
      headers: { "x-agent-id": "agent-beta" },
      body: { jsonrpc: "2.0", method: "initialize", id: 1 },
    });
    await postHandler!(req2, createMockRes(), vi.fn());

    expect(getConnectedAgents()).toHaveLength(2);
    expect(getAgentBySession("smoke-session-1")).toBe("agent-alpha");
    expect(getAgentBySession("smoke-session-2")).toBe("agent-beta");
  });

  it("POST with invalid session returns 404", async () => {
    const req = createMockReq({
      method: "POST",
      headers: { "mcp-session-id": "invalid-session" },
      body: { jsonrpc: "2.0", method: "tools/list", id: 1 },
    });
    const res = createMockRes();

    const postHandler = findRouteHandler(mcpRouter, "post", "/");
    await postHandler!(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ============================================================================
// Helpers
// ============================================================================

interface MockReqOptions {
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
}

function createMockReq(opts: MockReqOptions) {
  return {
    method: opts.method,
    query: opts.query ?? {},
    headers: opts.headers,
    body: opts.body,
    on: vi.fn(),
  };
}

function createMockRes() {
  const res = {
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
    headersSent: false,
  };
  res.status.mockReturnValue(res);
  return res;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findRouteHandler(router: any, method: string, path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const layer of router.stack) {
    if (
      layer.route &&
      layer.route.path === path &&
      layer.route.methods[method]
    ) {
      const handlers = layer.route.stack;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return handlers[handlers.length - 1].handle as (...args: any[]) => any;
    }
  }
  return undefined;
}
