import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer, type Server as HttpServer } from "http";
import { WebSocket } from "ws";

// Mock dependencies before importing the module under test
vi.mock("../../src/services/event-bus.js", () => {
  const bus = {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    onAny: vi.fn(),
    offAny: vi.fn(),
    getSeq: vi.fn(() => 0),
    listenerCounts: vi.fn(() => ({})),
  };
  return {
    getEventBus: vi.fn(() => bus),
    resetEventBus: vi.fn(),
  };
});

vi.mock("../../src/services/api-key-service.js", () => ({
  hasApiKeys: vi.fn(() => false),
  validateApiKey: vi.fn(() => false),
}));

vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

import {
  initWebSocketServer,
  getWsServer,
  getWsClientCount,
  getWsAuthenticatedCount,
  wsBroadcast,
  closeWsServer,
} from "../../src/services/ws-server.js";
import { hasApiKeys, validateApiKey } from "../../src/services/api-key-service.js";
import { getEventBus } from "../../src/services/event-bus.js";

// ============================================================================
// Helpers
// ============================================================================

let httpServer: HttpServer;
let serverPort: number;

function wsUrl(): string {
  return `ws://localhost:${serverPort}/ws/chat`;
}

/**
 * A buffered WebSocket client that captures all messages from the moment
 * of creation, avoiding race conditions between connect and message receipt.
 */
class WsTestClient {
  ws: WebSocket;
  private messageQueue: Record<string, unknown>[] = [];
  private waiters: Array<(msg: Record<string, unknown>) => void> = [];
  private _openPromise: Promise<void>;
  private _closePromise: Promise<{ code: number; reason: string }>;

  constructor(url: string) {
    this.ws = new WebSocket(url);

    // Set up message buffering IMMEDIATELY - before open fires
    this.ws.on("message", (raw) => {
      const parsed = JSON.parse(raw.toString());
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(parsed);
      } else {
        this.messageQueue.push(parsed);
      }
    });

    this._openPromise = new Promise((resolve, reject) => {
      this.ws.on("open", () => resolve());
      this.ws.on("error", reject);
    });

    this._closePromise = new Promise((resolve) => {
      this.ws.on("close", (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });
  }

  async waitOpen(): Promise<void> {
    await this._openPromise;
  }

  async waitClose(): Promise<{ code: number; reason: string }> {
    return this._closePromise;
  }

  /** Get the next message, either from the buffer or wait for one. */
  recv(timeoutMs = 3000): Promise<Record<string, unknown>> {
    const buffered = this.messageQueue.shift();
    if (buffered) return Promise.resolve(buffered);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove this waiter
        const idx = this.waiters.indexOf(resolve);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error("Timed out waiting for message"));
      }, timeoutMs);

      this.waiters.push((msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  send(msg: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws.close();
  }
}

/** Create a connected WsTestClient. */
async function connect(): Promise<WsTestClient> {
  const client = new WsTestClient(wsUrl());
  await client.waitOpen();
  return client;
}

/** Connect and authenticate in open mode. */
async function connectAndAuth(): Promise<WsTestClient> {
  const client = await connect();
  const challenge = await client.recv();
  expect(challenge.type).toBe("auth_challenge");
  client.send({ type: "auth_response" });
  const connected = await client.recv();
  expect(connected.type).toBe("connected");
  return client;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Test Suite
// ============================================================================

describe("ws-server", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Default: no API keys (open mode)
    vi.mocked(hasApiKeys).mockReturnValue(false);
    vi.mocked(validateApiKey).mockReturnValue(false);

    // Create a fresh HTTP server for each test
    httpServer = createServer();
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        if (addr && typeof addr !== "string") {
          serverPort = addr.port;
        }
        resolve();
      });
    });

    initWebSocketServer(httpServer);
  });

  afterEach(async () => {
    closeWsServer();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  });

  // --------------------------------------------------------------------------
  // Connection & Auth
  // --------------------------------------------------------------------------

  describe("connection and auth", () => {
    it("should send auth_challenge on connection", async () => {
      const client = await connect();
      const msg = await client.recv();
      expect(msg.type).toBe("auth_challenge");
      client.close();
    });

    it("should authenticate in open mode (no API keys)", async () => {
      const client = await connect();
      const challenge = await client.recv();
      expect(challenge.type).toBe("auth_challenge");

      client.send({ type: "auth_response" });
      const connected = await client.recv();
      expect(connected.type).toBe("connected");
      expect(connected.sessionId).toBeDefined();
      expect(connected.serverTime).toBeDefined();
      expect(connected.lastSeq).toBeDefined();
      client.close();
    });

    it("should authenticate with valid API key", async () => {
      vi.mocked(hasApiKeys).mockReturnValue(true);
      vi.mocked(validateApiKey).mockReturnValue(true);

      const client = await connect();
      await client.recv(); // auth_challenge
      client.send({ type: "auth_response", apiKey: "valid-key" });
      const connected = await client.recv();
      expect(connected.type).toBe("connected");
      client.close();
    });

    it("should reject missing API key when keys are configured", async () => {
      vi.mocked(hasApiKeys).mockReturnValue(true);

      const client = await connect();
      await client.recv(); // auth_challenge
      client.send({ type: "auth_response" });
      const err = await client.recv();
      expect(err.type).toBe("error");
      expect(err.code).toBe("auth_failed");
      await client.waitClose();
    });

    it("should reject invalid API key", async () => {
      vi.mocked(hasApiKeys).mockReturnValue(true);
      vi.mocked(validateApiKey).mockReturnValue(false);

      const client = await connect();
      await client.recv(); // auth_challenge
      client.send({ type: "auth_response", apiKey: "bad-key" });
      const err = await client.recv();
      expect(err.type).toBe("error");
      expect(err.code).toBe("auth_failed");
      await client.waitClose();
    });

    it("should reject non-auth messages before authentication", async () => {
      const client = await connect();
      await client.recv(); // auth_challenge
      client.send({ type: "message", body: "hello" });
      const err = await client.recv();
      expect(err.type).toBe("error");
      expect(err.code).toBe("not_authenticated");
      client.close();
    });

    it("should handle invalid JSON gracefully", async () => {
      const client = await connect();
      await client.recv(); // auth_challenge
      client.ws.send("not valid json{{{");
      const err = await client.recv();
      expect(err.type).toBe("error");
      expect(err.code).toBe("parse_error");
      client.close();
    });
  });

  // --------------------------------------------------------------------------
  // Messaging
  // --------------------------------------------------------------------------

  describe("messaging", () => {
    it("should deliver message and send delivery confirmation", async () => {
      const client = await connectAndAuth();
      client.send({ type: "message", id: "msg-1", body: "hello world" });

      const delivered = await client.recv();
      expect(delivered.type).toBe("delivered");
      expect(delivered.clientId).toBe("msg-1");
      expect(delivered.messageId).toBeDefined();
      expect(delivered.timestamp).toBeDefined();

      // Sender also gets the broadcast
      const broadcast = await client.recv();
      expect(broadcast.type).toBe("message");
      expect(broadcast.body).toBe("hello world");
      expect(broadcast.seq).toBeDefined();
      expect(broadcast.from).toBe("overseer");

      client.close();
    });

    it("should broadcast messages to other authenticated clients", async () => {
      const c1 = await connectAndAuth();
      const c2 = await connectAndAuth();

      c1.send({ type: "message", id: "msg-2", body: "from client 1" });

      const broadcast = await c2.recv();
      expect(broadcast.type).toBe("message");
      expect(broadcast.body).toBe("from client 1");

      c1.close();
      c2.close();
    });

    it("should emit mail:received on EventBus for messages", async () => {
      const bus = getEventBus();
      const client = await connectAndAuth();
      client.send({ type: "message", id: "msg-3", body: "test event bus" });
      await client.recv(); // delivered
      await client.recv(); // broadcast

      expect(bus.emit).toHaveBeenCalledWith(
        "mail:received",
        expect.objectContaining({
          from: "overseer",
          subject: "(WebSocket message)",
        }),
      );

      client.close();
    });

    it("should include replyTo and metadata in messages", async () => {
      const client = await connectAndAuth();
      client.send({
        type: "message",
        id: "msg-4",
        body: "reply",
        replyTo: "original-id",
        metadata: { foo: "bar" },
      });
      await client.recv(); // delivered
      const broadcast = await client.recv();
      expect(broadcast.replyTo).toBe("original-id");
      expect(broadcast.metadata).toEqual({ foo: "bar" });

      client.close();
    });

    it("should default to mayor/ when no 'to' field", async () => {
      const client = await connectAndAuth();
      client.send({ type: "message", id: "msg-5", body: "no target" });
      await client.recv(); // delivered
      const broadcast = await client.recv();
      expect(broadcast.to).toBe("mayor/");

      client.close();
    });
  });

  // --------------------------------------------------------------------------
  // Typing
  // --------------------------------------------------------------------------

  describe("typing", () => {
    it("should broadcast typing indicators to other clients", async () => {
      const c1 = await connectAndAuth();
      const c2 = await connectAndAuth();

      c1.send({ type: "typing", state: "started" });

      const typing = await c2.recv();
      expect(typing.type).toBe("typing");
      expect(typing.from).toBe("overseer");
      expect(typing.state).toBe("started");

      c1.close();
      c2.close();
    });

    it("should not echo typing back to sender", async () => {
      const c1 = await connectAndAuth();
      const c2 = await connectAndAuth();

      c1.send({ type: "typing", state: "started" });

      // c2 gets the typing event
      const typing = await c2.recv();
      expect(typing.type).toBe("typing");

      // c1 should NOT get its own typing event back
      c1.send({ type: "message", id: "check", body: "check" });
      const next = await c1.recv();
      expect(next.type).toBe("delivered"); // Not "typing"

      c1.close();
      c2.close();
    });
  });

  // --------------------------------------------------------------------------
  // Sequence Numbering & Sync
  // --------------------------------------------------------------------------

  describe("sequence and sync", () => {
    it("should assign incrementing sequence numbers to messages", async () => {
      const client = await connectAndAuth();

      client.send({ type: "message", id: "seq-1", body: "first" });
      await client.recv(); // delivered
      const msg1 = await client.recv();

      client.send({ type: "message", id: "seq-2", body: "second" });
      await client.recv(); // delivered
      const msg2 = await client.recv();

      expect(typeof msg1.seq).toBe("number");
      expect(typeof msg2.seq).toBe("number");
      expect(msg2.seq as number).toBeGreaterThan(msg1.seq as number);

      client.close();
    });

    it("should replay missed messages on sync request", async () => {
      const c1 = await connectAndAuth();

      // Send messages to populate replay buffer
      c1.send({ type: "message", id: "replay-1", body: "msg one" });
      await c1.recv(); // delivered
      const broadcast1 = await c1.recv();

      c1.send({ type: "message", id: "replay-2", body: "msg two" });
      await c1.recv(); // delivered
      await c1.recv(); // broadcast

      // New client connects and syncs from before first message
      const c2 = await connectAndAuth();
      const beforeSeq = (broadcast1.seq as number) - 1;
      c2.send({ type: "sync", lastSeqSeen: beforeSeq });
      const syncResp = await c2.recv();
      expect(syncResp.type).toBe("sync_response");
      expect(Array.isArray(syncResp.missed)).toBe(true);
      expect((syncResp.missed as unknown[]).length).toBeGreaterThanOrEqual(2);

      c1.close();
      c2.close();
    });
  });

  // --------------------------------------------------------------------------
  // Ack
  // --------------------------------------------------------------------------

  describe("ack", () => {
    it("should accept ack without error", async () => {
      const client = await connectAndAuth();
      client.send({ type: "ack", seq: 5 });
      // Verify connection still works after ack
      client.send({ type: "message", id: "after-ack", body: "test" });
      const delivered = await client.recv();
      expect(delivered.type).toBe("delivered");

      client.close();
    });
  });

  // --------------------------------------------------------------------------
  // Rate Limiting
  // --------------------------------------------------------------------------

  describe("rate limiting", () => {
    it("should rate limit messages exceeding 60/min", async () => {
      const client = await connectAndAuth();

      // Send 61 messages rapidly
      for (let i = 0; i < 61; i++) {
        client.send({ type: "message", id: `rate-${i}`, body: `msg ${i}` });
      }

      // Collect responses until we find a rate_limited error or exhaust
      const responses: Record<string, unknown>[] = [];
      for (let i = 0; i < 130; i++) {
        try {
          const msg = await client.recv(2000);
          responses.push(msg);
        } catch {
          break;
        }
      }

      const rateLimited = responses.filter(
        (r) => r.type === "error" && r.code === "rate_limited",
      );
      expect(rateLimited.length).toBeGreaterThan(0);

      client.close();
    });
  });

  // --------------------------------------------------------------------------
  // Unknown message types
  // --------------------------------------------------------------------------

  describe("unknown types", () => {
    it("should return error for unknown message types", async () => {
      const client = await connectAndAuth();
      client.send({ type: "foobar" });
      const err = await client.recv();
      expect(err.type).toBe("error");
      expect(err.code).toBe("unknown_type");

      client.close();
    });
  });

  // --------------------------------------------------------------------------
  // Stream request (stub)
  // --------------------------------------------------------------------------

  describe("stream_request", () => {
    it("should return not_implemented for stream requests", async () => {
      const client = await connectAndAuth();
      client.send({ type: "stream_request", id: "stream-1" });
      const err = await client.recv();
      expect(err.type).toBe("error");
      expect(err.code).toBe("not_implemented");
      expect(err.relatedId).toBe("stream-1");

      client.close();
    });
  });

  // --------------------------------------------------------------------------
  // wsBroadcast (public API)
  // --------------------------------------------------------------------------

  describe("wsBroadcast", () => {
    it("should broadcast to all authenticated clients with sequence number", async () => {
      const client = await connectAndAuth();

      wsBroadcast({ type: "message", body: "from service" });

      const msg = await client.recv();
      expect(msg.type).toBe("message");
      expect(msg.body).toBe("from service");
      expect(msg.seq).toBeDefined();

      client.close();
    });
  });

  // --------------------------------------------------------------------------
  // Client tracking
  // --------------------------------------------------------------------------

  describe("client tracking", () => {
    it("should track connected clients", async () => {
      expect(getWsClientCount()).toBe(0);
      const client = await connect();
      await delay(50);
      expect(getWsClientCount()).toBe(1);

      client.close();
      await delay(50);
      expect(getWsClientCount()).toBe(0);
    });

    it("should track authenticated clients", async () => {
      expect(getWsAuthenticatedCount()).toBe(0);
      const client = await connectAndAuth();
      expect(getWsAuthenticatedCount()).toBe(1);

      client.close();
      await delay(50);
      expect(getWsAuthenticatedCount()).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Server lifecycle
  // --------------------------------------------------------------------------

  describe("server lifecycle", () => {
    it("getWsServer should return the WSS instance after init", () => {
      expect(getWsServer()).not.toBeNull();
    });

    it("initWebSocketServer should be idempotent", () => {
      const wss1 = getWsServer();
      initWebSocketServer(httpServer);
      const wss2 = getWsServer();
      expect(wss1).toBe(wss2);
    });

    it("closeWsServer should disconnect all clients", async () => {
      const client = await connectAndAuth();
      const closed = client.waitClose();
      closeWsServer();
      await closed;
      expect(getWsServer()).toBeNull();
      expect(getWsClientCount()).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Disconnection
  // --------------------------------------------------------------------------

  describe("disconnection", () => {
    it("should clean up client state on disconnect", async () => {
      const client = await connectAndAuth();
      expect(getWsClientCount()).toBe(1);

      client.close();
      await delay(50);
      expect(getWsClientCount()).toBe(0);
    });
  });
});
