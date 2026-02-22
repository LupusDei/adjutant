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
import { logInfo, logWarn } from "../utils/index.js";
import type { MessageStore } from "./message-store.js";

// ============================================================================
// Types
// ============================================================================

/** Client → Server message types */
interface WsClientMessage {
  type: "auth" | "auth_response" | "message" | "typing" | "stream_request" | "stream_cancel" | "ack" | "sync"
    | "session_connect" | "session_disconnect" | "session_input" | "session_interrupt" | "session_permission_response";
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
  // Session v2 fields
  sessionId?: string;
  text?: string;
  approved?: boolean;
  replay?: boolean;
}

/** Server → Client message types */
interface WsServerMessage {
  type: "auth_challenge" | "connected" | "message" | "chat_message" | "stream_token" | "stream_end" | "typing" | "delivered" | "error" | "sync_response" | "pong"
    | "session_connected" | "session_disconnected" | "session_output" | "session_raw" | "session_status";
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
  // Session v2 fields
  output?: string | undefined;
  buffer?: string[] | undefined;
  status?: string | undefined;
  name?: string | undefined;
  events?: unknown[] | undefined;
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
let messageStore: MessageStore | null = null;
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

  if (!messageStore) {
    logWarn("ws handleMessage: no message store configured, dropping message");
    send(client, {
      type: "error",
      code: "server_error",
      message: "Message store not available",
      relatedId: msg.id,
    });
    return;
  }

  // Persist to SQLite via message store
  const recipient = msg.to ?? "mayor/";
  const message = messageStore.insertMessage({
    agentId: "user",
    recipient,
    role: "user",
    body: msg.body ?? "",
  });

  // Send delivery confirmation to sender
  send(client, {
    type: "delivered",
    messageId: message.id,
    clientId: msg.id,
    timestamp: message.createdAt,
  });

  // Broadcast persisted chat_message to all authenticated clients
  wsBroadcast({
    type: "chat_message",
    id: message.id,
    from: "user",
    to: recipient,
    body: message.body,
    timestamp: message.createdAt,
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
// Session v2 Handlers
// ============================================================================

async function handleSessionConnect(client: WsClient, msg: WsClientMessage): Promise<void> {
  const { sessionId, replay } = msg;
  logInfo("handleSessionConnect", { sessionId, replay, clientId: client.sessionId });
  if (!sessionId) {
    send(client, { type: "error", code: "missing_session_id", message: "sessionId required" });
    return;
  }

  try {
    const { getSessionBridge } = await import("./session-bridge.js");
    const bridge = getSessionBridge();
    logInfo("session_connect: calling connectClient", { sessionId, sessions: bridge.listSessions().map(s => s.id) });
    const result = await bridge.connectClient(sessionId, client.sessionId, replay ?? false);
    logInfo("session_connect: connectClient result", { sessionId, success: result.success, error: result.error });

    if (result.success) {
      send(client, {
        type: "session_connected",
        sessionId,
        buffer: result.buffer,
      });

      // Set up output forwarding for this client
      bridge.connector.onOutput((sid, line, events) => {
        if (sid === sessionId && client.authenticated) {
          // Structured events for chat view
          if (events.length > 0) {
            logInfo("ws sending session_output", { sessionId: sid, eventCount: events.length, types: events.map(e => e.type) });
            send(client, {
              type: "session_output",
              sessionId: sid,
              events,
            });
          }
          // Raw line for terminal view
          send(client, {
            type: "session_raw",
            sessionId: sid,
            output: line,
          });
        }
      });
    } else {
      send(client, {
        type: "error",
        code: "session_connect_failed",
        message: result.error ?? "Failed to connect to session",
        sessionId,
      });
    }
  } catch (err) {
    send(client, {
      type: "error",
      code: "session_error",
      message: String(err),
      sessionId,
    });
  }
}

async function handleSessionDisconnect(client: WsClient, msg: WsClientMessage): Promise<void> {
  const { sessionId } = msg;
  if (!sessionId) {
    send(client, { type: "error", code: "missing_session_id", message: "sessionId required" });
    return;
  }

  try {
    const { getSessionBridge } = await import("./session-bridge.js");
    const bridge = getSessionBridge();
    await bridge.disconnectClient(sessionId, client.sessionId);
    send(client, { type: "session_disconnected", sessionId });
  } catch (err) {
    send(client, {
      type: "error",
      code: "session_error",
      message: String(err),
      sessionId,
    });
  }
}

async function handleSessionInput(client: WsClient, msg: WsClientMessage): Promise<void> {
  const { sessionId, text } = msg;
  if (!sessionId || text === undefined) {
    send(client, { type: "error", code: "missing_params", message: "sessionId and text required" });
    return;
  }

  try {
    const { getSessionBridge } = await import("./session-bridge.js");
    const bridge = getSessionBridge();
    const sent = await bridge.sendInput(sessionId, text);
    if (!sent) {
      send(client, {
        type: "error",
        code: "input_failed",
        message: "Failed to send input to session",
        sessionId,
      });
    }
  } catch (err) {
    send(client, {
      type: "error",
      code: "session_error",
      message: String(err),
      sessionId,
    });
  }
}

async function handleSessionInterrupt(client: WsClient, msg: WsClientMessage): Promise<void> {
  const { sessionId } = msg;
  if (!sessionId) {
    send(client, { type: "error", code: "missing_session_id", message: "sessionId required" });
    return;
  }

  try {
    const { getSessionBridge } = await import("./session-bridge.js");
    const bridge = getSessionBridge();
    const sent = await bridge.sendInterrupt(sessionId);
    if (!sent) {
      send(client, {
        type: "error",
        code: "interrupt_failed",
        message: "Failed to send interrupt to session",
        sessionId,
      });
    }
  } catch (err) {
    send(client, {
      type: "error",
      code: "session_error",
      message: String(err),
      sessionId,
    });
  }
}

async function handleSessionPermissionResponse(client: WsClient, msg: WsClientMessage): Promise<void> {
  const { sessionId, approved } = msg;
  if (!sessionId || approved === undefined) {
    send(client, { type: "error", code: "missing_params", message: "sessionId and approved required" });
    return;
  }

  try {
    const { getSessionBridge } = await import("./session-bridge.js");
    const bridge = getSessionBridge();
    const sent = await bridge.sendPermissionResponse(sessionId, approved);
    if (!sent) {
      send(client, {
        type: "error",
        code: "permission_response_failed",
        message: "Failed to send permission response to session",
        sessionId,
      });
    }
  } catch (err) {
    send(client, {
      type: "error",
      code: "session_error",
      message: String(err),
      sessionId,
    });
  }
}

// ============================================================================
// Server Setup
// ============================================================================

/**
 * Initialize the WebSocket server on the existing HTTP server.
 */
export function initWebSocketServer(server: HttpServer, store?: MessageStore): WebSocketServer {
  if (wss) return wss;
  if (store) messageStore = store;

  wss = new WebSocketServer({ noServer: true });

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
        if (msg.type === "auth_response" || msg.type === "auth") {
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
        // Session v2 message types
        case "session_connect":
          handleSessionConnect(client, msg).catch((err) => {
            logWarn("session_connect error", { error: String(err) });
          });
          break;
        case "session_disconnect":
          handleSessionDisconnect(client, msg).catch((err) => {
            logWarn("session_disconnect error", { error: String(err) });
          });
          break;
        case "session_input":
          handleSessionInput(client, msg).catch((err) => {
            logWarn("session_input error", { error: String(err) });
          });
          break;
        case "session_interrupt":
          handleSessionInterrupt(client, msg).catch((err) => {
            logWarn("session_interrupt error", { error: String(err) });
          });
          break;
        case "session_permission_response":
          handleSessionPermissionResponse(client, msg).catch((err) => {
            logWarn("session_permission_response error", { error: String(err) });
          });
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

      // Clean up any session bridge connections for this client
      import("./session-bridge.js")
        .then(({ getSessionBridge }) => {
          const bridge = getSessionBridge();
          for (const s of bridge.registry.getAll()) {
            if (s.connectedClients.has(client.sessionId)) {
              bridge.disconnectClient(s.id, client.sessionId).catch(() => {});
            }
          }
        })
        .catch(() => {});
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
