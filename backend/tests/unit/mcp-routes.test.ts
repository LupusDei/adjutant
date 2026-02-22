import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Hoisted mocks for mcp-server
const {
  mockCreateSessionTransport,
  mockDisconnectAgent,
  mockResolveAgentId,
  mockGetTransportBySession,
} = vi.hoisted(() => ({
  mockCreateSessionTransport: vi.fn(),
  mockDisconnectAgent: vi.fn(),
  mockResolveAgentId: vi.fn(),
  mockGetTransportBySession: vi.fn(),
}));

vi.mock("../../src/services/mcp-server.js", () => ({
  createSessionTransport: mockCreateSessionTransport,
  disconnectAgent: mockDisconnectAgent,
  resolveAgentId: mockResolveAgentId,
  getTransportBySession: mockGetTransportBySession,
}));

// Mock SDK types — use real isInitializeRequest logic
const { mockIsInitializeRequest } = vi.hoisted(() => ({
  mockIsInitializeRequest: vi.fn((value: unknown) => {
    if (typeof value !== "object" || value === null) return false;
    const obj = value as Record<string, unknown>;
    return obj["method"] === "initialize" && obj["jsonrpc"] === "2.0";
  }),
}));

vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
  isInitializeRequest: mockIsInitializeRequest,
}));

import { mcpRouter } from "../../src/routes/mcp.js";

describe("MCP Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should export a router", () => {
    expect(mcpRouter).toBeDefined();
  });

  describe("POST / (initialization)", () => {
    it("should create new session for initialize request without session ID", async () => {
      const mockTransport = {
        handleRequest: vi.fn().mockResolvedValue(undefined),
      };
      const mockServer = {};

      mockResolveAgentId.mockReturnValue("researcher");
      mockCreateSessionTransport.mockResolvedValue({
        transport: mockTransport,
        server: mockServer,
      });

      const req = createMockReq({
        method: "POST",
        headers: { "x-agent-id": "researcher" },
        body: { jsonrpc: "2.0", method: "initialize", id: 1 },
      });
      const res = createMockRes();

      const handler = findRouteHandler(mcpRouter, "post", "/");
      expect(handler).toBeDefined();

      await handler!(req, res, vi.fn());

      expect(mockResolveAgentId).toHaveBeenCalled();
      expect(mockCreateSessionTransport).toHaveBeenCalledWith("researcher");
      expect(mockTransport.handleRequest).toHaveBeenCalledWith(req, res, req.body);
    });

    it("should route to existing transport when session ID header is present", async () => {
      const mockTransport = {
        handleRequest: vi.fn().mockResolvedValue(undefined),
      };

      mockGetTransportBySession.mockReturnValue(mockTransport);

      const req = createMockReq({
        method: "POST",
        headers: { "mcp-session-id": "session-abc" },
        body: { jsonrpc: "2.0", method: "tools/list", id: 2 },
      });
      const res = createMockRes();

      const handler = findRouteHandler(mcpRouter, "post", "/");
      await handler!(req, res, vi.fn());

      expect(mockGetTransportBySession).toHaveBeenCalledWith("session-abc");
      expect(mockTransport.handleRequest).toHaveBeenCalledWith(req, res, req.body);
    });

    it("should return 404 for unknown session ID", async () => {
      mockGetTransportBySession.mockReturnValue(undefined);

      const req = createMockReq({
        method: "POST",
        headers: { "mcp-session-id": "nonexistent" },
        body: { jsonrpc: "2.0", method: "tools/list", id: 2 },
      });
      const res = createMockRes();

      const handler = findRouteHandler(mcpRouter, "post", "/");
      await handler!(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
    });

    it("should return 500 when transport creation fails", async () => {
      mockResolveAgentId.mockReturnValue("researcher");
      mockCreateSessionTransport.mockRejectedValue(new Error("creation failed"));

      const req = createMockReq({
        method: "POST",
        headers: {},
        body: { jsonrpc: "2.0", method: "initialize", id: 1 },
      });
      const res = createMockRes();

      const handler = findRouteHandler(mcpRouter, "post", "/");
      await handler!(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it("should return 400 for non-initialize request without session ID", async () => {
      const req = createMockReq({
        method: "POST",
        headers: {},
        body: { jsonrpc: "2.0", method: "tools/list", id: 1 },
      });
      const res = createMockRes();

      const handler = findRouteHandler(mcpRouter, "post", "/");
      await handler!(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockCreateSessionTransport).not.toHaveBeenCalled();
    });
  });

  describe("GET / (SSE stream)", () => {
    it("should route to existing transport for valid session", async () => {
      const mockTransport = {
        handleRequest: vi.fn().mockResolvedValue(undefined),
      };

      mockGetTransportBySession.mockReturnValue(mockTransport);

      const req = createMockReq({
        method: "GET",
        headers: { "mcp-session-id": "session-abc" },
      });
      const res = createMockRes();

      const handler = findRouteHandler(mcpRouter, "get", "/");
      expect(handler).toBeDefined();

      await handler!(req, res, vi.fn());

      expect(mockGetTransportBySession).toHaveBeenCalledWith("session-abc");
      expect(mockTransport.handleRequest).toHaveBeenCalledWith(req, res);
    });

    it("should return 400 when no session ID header", async () => {
      const req = createMockReq({
        method: "GET",
        headers: {},
      });
      const res = createMockRes();

      const handler = findRouteHandler(mcpRouter, "get", "/");
      await handler!(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 404 for unknown session", async () => {
      mockGetTransportBySession.mockReturnValue(undefined);

      const req = createMockReq({
        method: "GET",
        headers: { "mcp-session-id": "nonexistent" },
      });
      const res = createMockRes();

      const handler = findRouteHandler(mcpRouter, "get", "/");
      await handler!(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe("DELETE / (session termination)", () => {
    it("should route to existing transport for valid session", async () => {
      const mockTransport = {
        handleRequest: vi.fn().mockResolvedValue(undefined),
      };

      mockGetTransportBySession.mockReturnValue(mockTransport);

      const req = createMockReq({
        method: "DELETE",
        headers: { "mcp-session-id": "session-abc" },
      });
      const res = createMockRes();

      const handler = findRouteHandler(mcpRouter, "delete", "/");
      expect(handler).toBeDefined();

      await handler!(req, res, vi.fn());

      expect(mockGetTransportBySession).toHaveBeenCalledWith("session-abc");
      expect(mockTransport.handleRequest).toHaveBeenCalledWith(req, res);
    });

    it("should return 400 when no session ID header", async () => {
      const req = createMockReq({
        method: "DELETE",
        headers: {},
      });
      const res = createMockRes();

      const handler = findRouteHandler(mcpRouter, "delete", "/");
      await handler!(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should return 404 for unknown session", async () => {
      mockGetTransportBySession.mockReturnValue(undefined);

      const req = createMockReq({
        method: "DELETE",
        headers: { "mcp-session-id": "nonexistent" },
      });
      const res = createMockRes();

      const handler = findRouteHandler(mcpRouter, "delete", "/");
      await handler!(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
    });
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

/**
 * Find a route handler on an Express router by method and path.
 */
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
