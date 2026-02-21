import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Hoisted mocks for mcp-server
const { mockConnectAgent, mockDisconnectAgent, mockResolveAgentId, mockGetTransportBySession } =
  vi.hoisted(() => ({
    mockConnectAgent: vi.fn(),
    mockDisconnectAgent: vi.fn(),
    mockResolveAgentId: vi.fn(),
    mockGetTransportBySession: vi.fn(),
  }));

vi.mock("../../src/services/mcp-server.js", () => ({
  connectAgent: mockConnectAgent,
  disconnectAgent: mockDisconnectAgent,
  resolveAgentId: mockResolveAgentId,
  getTransportBySession: mockGetTransportBySession,
}));

import { mcpRouter } from "../../src/routes/mcp.js";

describe("MCP Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should export a router", () => {
    expect(mcpRouter).toBeDefined();
  });

  describe("GET /sse", () => {
    it("should resolve agent identity and connect", async () => {
      const mockTransport = {
        sessionId: "sess-1",
        handlePostMessage: vi.fn(),
      };
      const mockConnection = {
        agentId: "researcher",
        sessionId: "sess-1",
        transport: mockTransport,
        connectedAt: new Date(),
      };

      mockResolveAgentId.mockReturnValue("researcher");
      mockConnectAgent.mockResolvedValue(mockConnection);

      const req = createMockReq({
        method: "GET",
        query: { agentId: "researcher" },
        headers: {},
      });
      const res = createMockRes();

      // Find the GET /sse handler from the router stack
      const handler = findRouteHandler(mcpRouter, "get", "/sse");
      expect(handler).toBeDefined();

      await handler!(req, res, vi.fn());

      expect(mockResolveAgentId).toHaveBeenCalledWith(
        { agentId: "researcher" },
        expect.any(Object),
      );
      expect(mockConnectAgent).toHaveBeenCalledWith("researcher", res);
    });

    it("should disconnect agent when request closes", async () => {
      const mockTransport = {
        sessionId: "sess-1",
        handlePostMessage: vi.fn(),
      };
      const mockConnection = {
        agentId: "researcher",
        sessionId: "sess-1",
        transport: mockTransport,
        connectedAt: new Date(),
      };

      mockResolveAgentId.mockReturnValue("researcher");
      mockConnectAgent.mockResolvedValue(mockConnection);

      let closeHandler: (() => void) | undefined;
      const req = createMockReq({
        method: "GET",
        query: {},
        headers: {},
        onClose: (fn: () => void) => {
          closeHandler = fn;
        },
      });
      const res = createMockRes();

      const handler = findRouteHandler(mcpRouter, "get", "/sse");
      await handler!(req, res, vi.fn());

      // Simulate connection close
      expect(closeHandler).toBeDefined();
      closeHandler!();

      expect(mockDisconnectAgent).toHaveBeenCalledWith("sess-1");
    });
  });

  describe("POST /messages", () => {
    it("should route message to correct transport", async () => {
      const mockHandlePost = vi.fn().mockResolvedValue(undefined);
      const mockTransport = {
        sessionId: "sess-1",
        handlePostMessage: mockHandlePost,
      };

      mockGetTransportBySession.mockReturnValue(mockTransport);

      const req = createMockReq({
        method: "POST",
        query: { sessionId: "sess-1" },
        headers: {},
      });
      const res = createMockRes();

      const handler = findRouteHandler(mcpRouter, "post", "/messages");
      expect(handler).toBeDefined();

      await handler!(req, res, vi.fn());

      expect(mockGetTransportBySession).toHaveBeenCalledWith("sess-1");
      expect(mockHandlePost).toHaveBeenCalledWith(req, res);
    });

    it("should return 404 for unknown session", async () => {
      mockGetTransportBySession.mockReturnValue(undefined);

      const req = createMockReq({
        method: "POST",
        query: { sessionId: "nonexistent" },
        headers: {},
      });
      const res = createMockRes();

      const handler = findRouteHandler(mcpRouter, "post", "/messages");
      await handler!(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
    });
  });
});

// ============================================================================
// Helpers
// ============================================================================

interface MockReqOptions {
  method: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  onClose?: (fn: () => void) => void;
}

function createMockReq(opts: MockReqOptions) {
  return {
    method: opts.method,
    query: opts.query,
    headers: opts.headers,
    on: vi.fn((event: string, fn: () => void) => {
      if (event === "close" && opts.onClose) {
        opts.onClose(fn);
      }
    }),
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
  };
  res.status.mockReturnValue(res);
  return res;
}

/**
 * Find a route handler on an Express router by method and path.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findRouteHandler(router: any, method: string, path: string) {
  // Express stores routes in router.stack
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const layer of router.stack) {
    if (
      layer.route &&
      layer.route.path === path &&
      layer.route.methods[method]
    ) {
      // Return the last handler (the actual route handler, not middleware)
      const handlers = layer.route.stack;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return handlers[handlers.length - 1].handle as (...args: any[]) => any;
    }
  }
  return undefined;
}
