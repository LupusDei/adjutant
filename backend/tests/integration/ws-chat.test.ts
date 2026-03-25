/**
 * Integration tests for WebSocket chat.
 *
 * Tests real WebSocket connections against the test server:
 * - Auth handshake protocol
 * - Message broadcast from REST API to WS clients
 * - Sync/replay after reconnection
 *
 * Uses the `ws` package as a test client (same library as server).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { WebSocket } from "ws";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { TestHarness } from "./helpers/test-harness.js";
import { initWebSocketServer, closeWsServer } from "../../src/services/ws-server.js";

// Force open mode: point API_KEYS_PATH at a non-existent file so hasApiKeys() returns false.
process.env["API_KEYS_PATH"] = join(tmpdir(), `adjutant-test-nokeys-${Date.now()}.json`);

/**
 * WS test client wrapper that buffers messages from connection open,
 * avoiding race conditions where server sends before listener is attached.
 */
class WsTestClient {
  ws: WebSocket;
  private messageBuffer: Record<string, unknown>[] = [];
  private waiters: {
    type: string;
    resolve: (msg: Record<string, unknown>) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (data: Buffer | string) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      // Check if any waiter matches
      const waiterIdx = this.waiters.findIndex((w) => w.type === msg["type"]);
      if (waiterIdx >= 0) {
         
        const waiter = this.waiters[waiterIdx]!;
        this.waiters.splice(waiterIdx, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(msg);
      } else {
        this.messageBuffer.push(msg);
      }
    });
  }

  /** Wait for a message of a given type (checks buffer first) */
  waitFor(type: string, timeoutMs = 5000): Promise<Record<string, unknown>> {
    // Check if already buffered
    const idx = this.messageBuffer.findIndex((m) => m["type"] === type);
    if (idx >= 0) {
       
      const msg = this.messageBuffer[idx]!;
      this.messageBuffer.splice(idx, 1);
      return Promise.resolve(msg);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiterIdx = this.waiters.findIndex((w) => w.resolve === resolve);
        if (waiterIdx >= 0) this.waiters.splice(waiterIdx, 1);
        reject(new Error(`Timed out waiting for WS message type '${type}'`));
      }, timeoutMs);

      this.waiters.push({ type, resolve, reject, timer });
    });
  }

  send(msg: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
    // Clear pending waiters
    for (const w of this.waiters) {
      clearTimeout(w.timer);
    }
    this.waiters.length = 0;
  }
}

/** Create a connected WsTestClient */
function connectClient(url: string): Promise<WsTestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    // Start buffering messages immediately
    const client = new WsTestClient(ws);
    ws.on("open", () => { resolve(client); });
    ws.on("error", reject);
  });
}

/** Complete the auth handshake (open mode) */
async function authenticate(client: WsTestClient): Promise<Record<string, unknown>> {
  const challenge = await client.waitFor("auth_challenge");
  expect(challenge["type"]).toBe("auth_challenge");

  client.send({ type: "auth_response" });

  const connected = await client.waitFor("connected");
  expect(connected["type"]).toBe("connected");
  expect(connected["sessionId"]).toBeDefined();
  return connected;
}

describe("WebSocket Chat Integration", () => {
  let harness: TestHarness;
  let wsUrl: string;
  const openClients: WsTestClient[] = [];

  beforeAll(async () => {
    harness = new TestHarness();
    await harness.start();

    // Initialize WebSocket server on the test HTTP server
     
    const chatWss = initWebSocketServer(harness.server!, harness.messageStore);

    // Wire up the upgrade handler for /ws/chat
    harness.server!.on("upgrade", (req, socket, head) => {
      const pathname = req.url?.split("?")[0];
      if (pathname === "/ws/chat") {
        chatWss.handleUpgrade(req, socket, head, (ws) => chatWss.emit("connection", ws, req));
      } else {
        socket.destroy();
      }
    });

    wsUrl = `ws://localhost:${harness.port}/ws/chat`;
  });

  afterEach(() => {
    for (const client of openClients) {
      client.close();
    }
    openClients.length = 0;
  });

  afterAll(async () => {
    closeWsServer();
    await harness.stop();
  });

  // =========================================================================
  // Auth handshake
  // =========================================================================

  describe("Auth handshake", () => {
    it("should complete auth handshake in open mode", async () => {
      const client = await connectClient(wsUrl);
      openClients.push(client);

      const connected = await authenticate(client);
      expect(connected["sessionId"]).toBeDefined();
      expect(typeof connected["lastSeq"]).toBe("number");
    });

    it("should reject messages before auth", async () => {
      const client = await connectClient(wsUrl);
      openClients.push(client);

      // Wait for auth_challenge first
      await client.waitFor("auth_challenge");

      // Try sending a message before authenticating
      client.send({ type: "message", body: "premature" });

      const error = await client.waitFor("error");
      expect(error["code"]).toBe("not_authenticated");
    });
  });

  // =========================================================================
  // REST -> WebSocket broadcast
  // =========================================================================

  describe("REST -> WebSocket broadcast", () => {
    it("should broadcast chat_message when a message is sent via REST API", async () => {
      const client = await connectClient(wsUrl);
      openClients.push(client);
      await authenticate(client);

      // Set up listener before sending
      const broadcastPromise = client.waitFor("chat_message");

      // Send message via REST API
      const res = await harness.sendMessage("test-ws-agent", "Hello via REST");
      expect(res.status).toBe(201);

      // WS client should receive the broadcast
      const msg = await broadcastPromise;
      expect(msg["from"]).toBe("user");
      expect(msg["to"]).toBe("test-ws-agent");
      expect(msg["body"]).toBe("Hello via REST");
      expect(msg["seq"]).toBeDefined();
    });

    it("should broadcast to multiple authenticated clients", async () => {
      const c1 = await connectClient(wsUrl);
      const c2 = await connectClient(wsUrl);
      openClients.push(c1, c2);
      await authenticate(c1);
      await authenticate(c2);

      const promise1 = c1.waitFor("chat_message");
      const promise2 = c2.waitFor("chat_message");

      await harness.sendMessage("multi-client-agent", "Broadcast test");

      const [msg1, msg2] = await Promise.all([promise1, promise2]);
      expect(msg1["body"]).toBe("Broadcast test");
      expect(msg2["body"]).toBe("Broadcast test");
    });
  });

  // =========================================================================
  // WS message sending
  // =========================================================================

  describe("WS message sending", () => {
    it("should persist a message sent via WebSocket and return delivery confirmation", async () => {
      const client = await connectClient(wsUrl);
      openClients.push(client);
      await authenticate(client);

      const deliveredPromise = client.waitFor("delivered");

      client.send({
        type: "message",
        id: "test-client-msg-1",
        to: "ws-target-agent",
        body: "Hello from WS client",
      });

      const delivered = await deliveredPromise;
      expect(delivered["clientId"]).toBe("test-client-msg-1");
      expect(delivered["messageId"]).toBeDefined();

      // Verify the message was persisted in the database
      const messageId = delivered["messageId"] as string;
      const getRes = await harness.getMessage(messageId);
      expect(getRes.status).toBe(200);
      expect(getRes.body.data.body).toBe("Hello from WS client");
      expect(getRes.body.data.recipient).toBe("ws-target-agent");
    });
  });

  // =========================================================================
  // Sync / replay
  // =========================================================================

  describe("Sync and replay", () => {
    it("should replay missed messages on sync request", async () => {
      const client = await connectClient(wsUrl);
      openClients.push(client);
      const connected = await authenticate(client);
      const lastSeq = connected["lastSeq"] as number;

      // Send a message so there's something in the replay buffer
      await harness.sendMessage("replay-agent", "Message to replay");

      // Consume the chat_message that was broadcast
      await client.waitFor("chat_message");

      // Request sync from before the message was sent
      client.send({
        type: "sync",
        lastSeqSeen: lastSeq,
      });

      const syncResponse = await client.waitFor("sync_response");
      const missed = syncResponse["missed"] as Record<string, unknown>[];
      expect(Array.isArray(missed)).toBe(true);
      expect(missed.length).toBeGreaterThanOrEqual(1);
      // The missed messages should include our chat_message
      const replayedMsg = missed.find((m) => m["body"] === "Message to replay");
      expect(replayedMsg).toBeDefined();
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe("Error handling", () => {
    it("should return error for unknown message type", async () => {
      const client = await connectClient(wsUrl);
      openClients.push(client);
      await authenticate(client);

      client.send({ type: "nonexistent_type" });

      const error = await client.waitFor("error");
      expect(error["code"]).toBe("unknown_type");
    });

    it("should return error for invalid JSON", async () => {
      const client = await connectClient(wsUrl);
      openClients.push(client);
      await authenticate(client);

      // Send raw invalid JSON directly
      client.ws.send("not valid json{{{");

      const error = await client.waitFor("error");
      expect(error["code"]).toBe("parse_error");
    });
  });
});
