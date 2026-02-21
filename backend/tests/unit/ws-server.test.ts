import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Capture the options passed to WebSocketServer constructor
let capturedWssOptions: Record<string, unknown> | undefined;
const mockWssOn = vi.fn();
const mockWssClose = vi.fn();

vi.mock("ws", () => {
  class MockWebSocketServer {
    constructor(options: Record<string, unknown>) {
      capturedWssOptions = options;
    }
    on = mockWssOn;
    close = mockWssClose;
  }
  return {
    WebSocketServer: MockWebSocketServer,
    WebSocket: { OPEN: 1 },
  };
});

// Suppress logging
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock event bus
vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }),
}));

// Mock api-key-service
vi.mock("../../src/services/api-key-service.js", () => ({
  hasApiKeys: vi.fn(() => false),
  validateApiKey: vi.fn(() => true),
}));

// Mock mail-service
vi.mock("../../src/services/mail-service.js", () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
}));

describe("ws-server", () => {
  beforeEach(() => {
    capturedWssOptions = undefined;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Reset the module-level singleton so each test starts fresh
    const mod = await import("../../src/services/ws-server.js");
    mod.closeWsServer();
  });

  describe("WebSocket server configuration", () => {
    it("should disable perMessageDeflate to prevent iOS connection failures through proxies", async () => {
      const { initWebSocketServer } = await import("../../src/services/ws-server.js");
      const fakeServer = {} as import("http").Server;

      initWebSocketServer(fakeServer);

      expect(capturedWssOptions).toBeDefined();
      expect(capturedWssOptions!.perMessageDeflate).toBe(false);
    });

    it("should use /ws/chat as the WebSocket path", async () => {
      const { initWebSocketServer } = await import("../../src/services/ws-server.js");
      const fakeServer = {} as import("http").Server;

      initWebSocketServer(fakeServer);

      expect(capturedWssOptions).toBeDefined();
      expect(capturedWssOptions!.path).toBe("/ws/chat");
    });
  });
});
