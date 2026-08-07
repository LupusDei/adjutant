/**
 * Regression tests for adj-bgpup — long-lived connections must be reaped.
 *
 * The chat WebSocket used to ping forever without ever checking for a pong,
 * so a client that vanished behind a tunnel (half-open TCP) stayed in the
 * client map indefinitely. Every reconnect left another zombie, saturating
 * the ngrok tunnel's connection gauge and the browser's per-origin socket
 * pool. These tests pin the pong-liveness sweep.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ============================================================================
// Mock WebSocket infrastructure
// ============================================================================

let connectionHandler: ((ws: MockWs) => void) | undefined;

class MockWs {
  readyState = 1; // OPEN
  sentMessages: string[] = [];
  pings = 0;
  terminated = false;
  closed = false;

  private handlers = new Map<string, ((...args: unknown[]) => void)[]>();

  on(event: string, handler: (...args: unknown[]) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  emit(event: string, ...args: unknown[]) {
    for (const h of this.handlers.get(event) ?? []) h(...args);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  ping() {
    this.pings++;
  }

  terminate() {
    this.terminated = true;
    this.readyState = 3; // CLOSED
    this.emit("close");
  }

  close(_code?: number, _reason?: string) {
    this.closed = true;
    this.readyState = 3;
    this.emit("close");
  }
}

vi.mock("ws", () => {
  class MockWebSocketServer {
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(_options: Record<string, unknown>) {}
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "connection") {
        connectionHandler = handler as (ws: MockWs) => void;
      }
    }
    close = vi.fn();
  }
  return {
    WebSocketServer: MockWebSocketServer,
    WebSocket: { OPEN: 1 },
  };
});

vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("../../src/services/event-bus.js", () => ({
  getEventBus: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }),
}));

vi.mock("../../src/services/api-key-service.js", () => ({
  hasApiKeys: () => false,
  validateApiKey: () => true,
}));

vi.mock("../../src/services/session-bridge.js", () => ({
  getSessionBridge: () => ({
    registry: { findByName: () => [], getAll: () => [] },
    connectClient: vi.fn().mockResolvedValue({ success: false }),
    disconnectClient: vi.fn().mockResolvedValue(undefined),
    sendInput: vi.fn().mockResolvedValue(true),
    connector: { onOutput: vi.fn(), offOutput: vi.fn() },
  }),
}));

/** The server's ping/liveness sweep interval. */
const PING_INTERVAL_MS = 30_000;

async function connectClient(): Promise<{
  ws: MockWs;
  mod: typeof import("../../src/services/ws-server.js");
}> {
  const mod = await import("../../src/services/ws-server.js");
  mod.initWebSocketServer({} as import("http").Server);
  const ws = new MockWs();
  connectionHandler!(ws);
  // Authenticate immediately — otherwise the 10s auth timeout closes the
  // socket before any liveness sweep runs.
  ws.emit("message", Buffer.from(JSON.stringify({ type: "auth_response" })));
  return { ws, mod };
}

// ============================================================================
// Tests
// ============================================================================

describe("ws-server liveness reaping (adj-bgpup)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    connectionHandler = undefined;
  });

  afterEach(async () => {
    const mod = await import("../../src/services/ws-server.js");
    mod.closeWsServer();
    vi.useRealTimers();
  });

  it("should terminate a client that never answers a ping", async () => {
    const { ws, mod } = await connectClient();
    expect(mod.getWsClientCount()).toBe(1);

    // First sweep: client is presumed alive on connect, gets pinged.
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(ws.pings).toBe(1);
    expect(ws.terminated).toBe(false);

    // Second sweep with no pong in between: the connection is half-open and
    // must be reaped, not pinged forever.
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(ws.terminated).toBe(true);
    expect(mod.getWsClientCount()).toBe(0);
  });

  it("should keep a client that answers with a pong", async () => {
    const { ws, mod } = await connectClient();

    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(PING_INTERVAL_MS);
      ws.emit("pong");
    }

    expect(ws.terminated).toBe(false);
    expect(mod.getWsClientCount()).toBe(1);
  });

  it("should drop the client from the registry when the socket errors", async () => {
    const { ws, mod } = await connectClient();
    expect(mod.getWsClientCount()).toBe(1);

    ws.emit("error", new Error("ECONNRESET"));

    expect(mod.getWsClientCount()).toBe(0);
  });

  it("should stop the liveness sweep once the last client disconnects", async () => {
    const { ws, mod } = await connectClient();
    ws.close();
    expect(mod.getWsClientCount()).toBe(0);

    const pingsAtClose = ws.pings;
    vi.advanceTimersByTime(PING_INTERVAL_MS * 3);

    // A closed client must never be pinged again — no orphaned timers.
    expect(ws.pings).toBe(pingsAtClose);
  });
});
