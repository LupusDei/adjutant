/**
 * WebSocket server for Adjutant real-time chat.
 *
 * Provides /ws/chat endpoint with:
 * - Auth handshake (API key in message, not URL)
 * - Message routing to agents via transport layer
 * - Sequence numbering for gap recovery
 * - Replay buffer (last 1000 messages or 1 hour)
 * - Ping/pong keepalive (30s interval)
 * - Rate limiting (60 msgs/min, 30 typing events/min)
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import { randomUUID } from "crypto";
import { getEventBus } from "./event-bus.js";
import { hasApiKeys, validateApiKey } from "./api-key-service.js";
import { sendMail } from "./mail-service.js";
import { logInfo, logWarn } from "../utils/index.js";

// ============================================================================
// Types
// ============================================================================

/** Client → Server message types */
interface WsClientMessage {
  type: "auth_response" | "message" | "typing" | "stream_request" | "stream_cancel" | "ack" | "sync";
  id?: string;
  to?: string;
  body?: string;
  subject?: string;
  replyTo?: string;
  metadata?: Record<string, unknown>;
  state?: "started" | "stopped";
  streamId?: string;
  streamTokens?: boolean;
  messageId?: string;
  seq?: number;
  apiKey?: string;
  lastSeqSeen?: number;
}

/** Server → Client message types */
interface WsServerMessage {
  type: "auth_challenge" | "connected" | "message" | "stream_token" | "stream_end" | "typing" | "delivered" | "error" | "sync_response" | "pong";
  id?: string | undefined;
  clientId?: string | undefined;
  seq?: number | undefined;
  from?: string | undefined;
  to?: string | undefined;
  body?: string | undefined;
  timestamp?: string | undefined;
  threadId?: string | undefined;
  replyTo?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  streamId?: string | undefined;
  token?: string | undefined;
  done?: boolean | undefined;
  messageId?: string | undefined;
  state?: string | undefined;
  code?: string | undefined;
  message?: string | undefined;
  relatedId?: string | undefined;
  sessionId?: string | undefined;
  lastSeq?: number | undefined;
  serverTime?: string | undefined;
  missed?: WsServerMessage[] | undefined;
}

interface WsClient {
  ws: WebSocket;
  sessionId: string;
  authenticated: boolean;
  lastSeqSeen: number;
  /** Rate limiting: message timestamps */
  messageTimestamps: number[];
  /** Rate limiting: typing timestamps */
  typingTimestamps: number[];
  pingTimer?: ReturnType<typeof setInterval>;
}

interface ReplayEntry {
  message: WsServerMessage;
  timestamp: number;
}

// ============================================================================
// Constants
// ============================================================================

const PING_INTERVAL_MS = 30_000;
const AUTH_TIMEOUT_MS = 10_000;
const MAX_REPLAY_BUFFER = 1000;
const REPLAY_TTL_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MESSAGES = 60;  // per minute
const RATE_LIMIT_TYPING = 30;    // per minute
const RATE_WINDOW_MS = 60_000;

// ============================================================================
// Server State
// ============================================================================

let wss: WebSocketServer | null = null;
const clients = new Map<string, WsClient>();
const replayBuffer: ReplayEntry[] = [];
let globalSeq = 0;

// ============================================================================
// Helpers
// ============================================================================

function nextSeq(): number {
  return ++globalSeq;
}

function send(client: WsClient, msg: WsServerMessage): void {
  if (client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(msg));
  }
}

function broadcast(msg: WsServerMessage): void {
  for (const client of clients.values()) {
    if (client.authenticated) {
      send(client, msg);
    }
  }
}

function addToReplay(msg: WsServerMessage): void {
  replayBuffer.push({ message: msg, timestamp: Date.now() });
  // Trim by size
  while (replayBuffer.length > MAX_REPLAY_BUFFER) {
    replayBuffer.shift();
  }
  // Trim by age
  const cutoff = Date.now() - REPLAY_TTL_MS;
  while (replayBuffer.length > 0 && replayBuffer[0]!.timestamp < cutoff) {
    replayBuffer.shift();
  }
}

function isRateLimited(timestamps: number[], limit: number): boolean {
  const now = Date.now();
  // Clean old entries
  while (timestamps.length > 0 && timestamps[0]! < now - RATE_WINDOW_MS) {
    timestamps.shift();
  }
  return timestamps.length >= limit;
}

// ============================================================================
// Message Handlers
// ============================================================================

function handleAuth(client: WsClient, msg: WsClientMessage): void {
  // If no API keys configured, allow all (open mode for development)
  if (!hasApiKeys()) {
    client.authenticated = true;
    send(client, {
      type: "connected",
      sessionId: client.sessionId,
      lastSeq: globalSeq,
      serverTime: new Date().toISOString(),
    });
    logInfo("ws client authenticated (open mode)", { sessionId: client.sessionId });
    return;
  }

  if (!msg.apiKey) {
    send(client, { type: "error", code: "auth_failed", message: "Missing apiKey" });
    client.ws.close(4001, "Authentication failed");
    return;
  }

  if (!validateApiKey(msg.apiKey)) {
    send(client, { type: "error", code: "auth_failed", message: "Invalid API key" });
    client.ws.close(4001, "Authentication failed");
    return;
  }

  client.authenticated = true;
  send(client, {
    type: "connected",
    sessionId: client.sessionId,
    lastSeq: globalSeq,
    serverTime: new Date().toISOString(),
  });

  logInfo("ws client authenticated", { sessionId: client.sessionId });
}

function handleMessage(client: WsClient, msg: WsClientMessage): void {
  if (isRateLimited(client.messageTimestamps, RATE_LIMIT_MESSAGES)) {
    send(client, {
      type: "error",
      code: "rate_limited",
      message: "Message rate limit exceeded (60/min)",
      relatedId: msg.id,
    });
    return;
  }
  client.messageTimestamps.push(Date.now());

  const seq = nextSeq();
  const serverMsg: WsServerMessage = {
    type: "message",
    id: randomUUID(),
    clientId: msg.id,
    seq,
    from: "overseer",
    to: msg.to ?? "mayor/",
    body: msg.body ?? "",
    timestamp: new Date().toISOString(),
    replyTo: msg.replyTo,
    metadata: msg.metadata,
  };

  addToReplay(serverMsg);

  // Send delivery confirmation to sender
  send(client, {
    type: "delivered",
    messageId: serverMsg.id,
    clientId: msg.id,
    timestamp: serverMsg.timestamp,
  });

  // Broadcast to all authenticated clients
  broadcast(serverMsg);

  // Persist the message via mail transport so agents can read it
  sendMail({
    to: serverMsg.to ?? "mayor/",
    from: serverMsg.from ?? "overseer",
    subject: msg.subject ?? "(WebSocket message)",
    body: serverMsg.body ?? "",
    replyTo: msg.replyTo,
  }).catch((err) => {
    logWarn("Failed to persist WebSocket message via mail transport", { error: String(err) });
  });
}

function handleTyping(client: WsClient, msg: WsClientMessage): void {
  if (isRateLimited(client.typingTimestamps, RATE_LIMIT_TYPING)) {
    return; // Silently drop excess typing events
  }
  client.typingTimestamps.push(Date.now());

  // Broadcast typing indicator to other clients
  for (const [, other] of clients) {
    if (other.sessionId !== client.sessionId && other.authenticated) {
      send(other, {
        type: "typing",
        from: "overseer",
        state: msg.state ?? "started",
      });
    }
  }
}

function handleSync(client: WsClient, msg: WsClientMessage): void {
  const lastSeen = msg.lastSeqSeen ?? 0;
  const missed = replayBuffer
    .filter((entry) => (entry.message.seq ?? 0) > lastSeen)
    .map((entry) => entry.message);

  send(client, {
    type: "sync_response",
    missed,
  });

  logInfo("ws sync", { sessionId: client.sessionId, lastSeen, missedCount: missed.length });
}

function handleAck(client: WsClient, msg: WsClientMessage): void {
  if (msg.seq !== undefined) {
    client.lastSeqSeen = msg.seq;
  }
}

// ============================================================================
// Server Setup
// ============================================================================

/**
 * Initialize the WebSocket server on the existing HTTP server.
 */
export function initWebSocketServer(server: HttpServer): WebSocketServer {
  if (wss) return wss;

  wss = new WebSocketServer({ server, path: "/ws/chat" });

  wss.on("connection", (ws) => {
    const sessionId = randomUUID();
    const client: WsClient = {
      ws,
      sessionId,
      authenticated: false,
      lastSeqSeen: 0,
      messageTimestamps: [],
      typingTimestamps: [],
    };

    clients.set(sessionId, client);

    // Send auth challenge
    send(client, { type: "auth_challenge" });

    // Auth timeout
    const authTimeout = setTimeout(() => {
      if (!client.authenticated) {
        send(client, { type: "error", code: "auth_timeout", message: "Authentication timed out" });
        ws.close(4002, "Auth timeout");
      }
    }, AUTH_TIMEOUT_MS);

    // Ping/pong keepalive
    client.pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, PING_INTERVAL_MS);

    ws.on("message", (raw) => {
      let msg: WsClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as WsClientMessage;
      } catch {
        send(client, { type: "error", code: "parse_error", message: "Invalid JSON" });
        return;
      }

      // Auth response must come first
      if (!client.authenticated) {
        if (msg.type === "auth_response") {
          clearTimeout(authTimeout);
          handleAuth(client, msg);
        } else {
          send(client, { type: "error", code: "not_authenticated", message: "Send auth_response first" });
        }
        return;
      }

      switch (msg.type) {
        case "message":
          handleMessage(client, msg);
          break;
        case "typing":
          handleTyping(client, msg);
          break;
        case "sync":
          handleSync(client, msg);
          break;
        case "ack":
          handleAck(client, msg);
          break;
        case "stream_request":
          // Stream requests will be handled by the streaming bridge (task 5)
          send(client, {
            type: "error",
            code: "not_implemented",
            message: "Streaming not yet available",
            relatedId: msg.id,
          });
          break;
        case "stream_cancel":
          // Will be implemented with streaming bridge
          break;
        default:
          send(client, { type: "error", code: "unknown_type", message: `Unknown message type: ${msg.type}` });
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimeout);
      if (client.pingTimer) clearInterval(client.pingTimer);
      clients.delete(sessionId);
      logInfo("ws client disconnected", { sessionId });
    });

    ws.on("error", (err) => {
      logInfo("ws client error", { sessionId, error: err.message });
    });
  });

  // Subscribe to EventBus events and relay to WS clients
  const eventBus = getEventBus();
  eventBus.on("agent:status_changed", (data) => {
    broadcast({
      type: "typing",
      from: data.agent,
      state: data.status === "working" ? "thinking" : "stopped",
    });
  });

  logInfo("WebSocket server initialized", { path: "/ws/chat" });

  return wss;
}

/**
 * Get the WebSocket server instance.
 */
export function getWsServer(): WebSocketServer | null {
  return wss;
}

/**
 * Get connected client count.
 */
export function getWsClientCount(): number {
  return clients.size;
}

/**
 * Get authenticated client count.
 */
export function getWsAuthenticatedCount(): number {
  let count = 0;
  for (const client of clients.values()) {
    if (client.authenticated) count++;
  }
  return count;
}

/**
 * Send a message to all authenticated WebSocket clients.
 * Used by other services (e.g., streaming bridge) to push data.
 */
export function wsBroadcast(msg: WsServerMessage): void {
  const seq = nextSeq();
  msg.seq = seq;
  addToReplay(msg);
  broadcast(msg);
}

/**
 * Shut down the WebSocket server.
 */
export function closeWsServer(): void {
  if (wss) {
    for (const client of clients.values()) {
      if (client.pingTimer) clearInterval(client.pingTimer);
      client.ws.close(1001, "Server shutting down");
    }
    clients.clear();
    wss.close();
    wss = null;
    logInfo("WebSocket server closed");
  }
}
