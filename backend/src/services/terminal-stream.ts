/**
 * Terminal Stream — WebSocket endpoint for real-time terminal output.
 *
 * Provides WS /api/terminal/stream that streams terminal output from
 * a session's tmux pane to connected clients.
 *
 * Protocol:
 *   Client → Server: { type: "subscribe", sessionId: "..." }
 *   Server → Client: { type: "subscribed", sessionId, content } (initial snapshot)
 *   Server → Client: { type: "output", sessionId, events } (incremental updates)
 *   Server → Client: { type: "snapshot", sessionId, content } (periodic full refresh)
 *   Server → Client: { type: "error", message }
 *   Client → Server: { type: "unsubscribe" }
 *   Server → Client: { type: "unsubscribed" }
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import { getEventBus } from "./event-bus.js";
import { logInfo, logWarn } from "../utils/index.js";
import type { OutputEvent } from "./output-parser.js";

/** How often to send a full terminal snapshot (ms). */
const SNAPSHOT_INTERVAL_MS = 10_000;

interface StreamClient {
  ws: WebSocket;
  sessionId: string | null;
  eventHandler: ((data: Record<string, unknown>, seq: number) => void) | null;
  snapshotTimer: ReturnType<typeof setInterval> | null;
}

let wss: WebSocketServer | null = null;

/**
 * Initialize the terminal stream WebSocket server.
 */
export function initTerminalStream(server: HttpServer): WebSocketServer {
  if (wss) return wss;

  wss = new WebSocketServer({ server, path: "/api/terminal/stream" });

  wss.on("connection", (ws) => {
    const client: StreamClient = {
      ws,
      sessionId: null,
      eventHandler: null,
      snapshotTimer: null,
    };

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        handleMessage(client, msg).catch((err) => {
          logWarn("terminal-stream message handler error", { error: String(err) });
        });
      } catch {
        sendToClient(client, { type: "error", message: "Invalid JSON" });
      }
    });

    ws.on("close", () => {
      cleanup(client);
    });

    ws.on("error", () => {
      cleanup(client);
    });
  });

  logInfo("Terminal stream WebSocket initialized", { path: "/api/terminal/stream" });
  return wss;
}

/**
 * Close the terminal stream WebSocket server.
 */
export function closeTerminalStream(): void {
  if (wss) {
    wss.close();
    wss = null;
  }
}

async function handleMessage(client: StreamClient, msg: Record<string, unknown>): Promise<void> {
  switch (msg['type']) {
    case "subscribe":
      await handleSubscribe(client, msg['sessionId'] as string);
      break;
    case "unsubscribe":
      cleanup(client);
      sendToClient(client, { type: "unsubscribed" });
      break;
    default:
      sendToClient(client, { type: "error", message: `Unknown message type: ${String(msg['type'])}` });
  }
}

async function handleSubscribe(client: StreamClient, sessionId: string): Promise<void> {
  if (!sessionId) {
    sendToClient(client, { type: "error", message: "sessionId required" });
    return;
  }

  // Clean up previous subscription
  cleanup(client);
  client.sessionId = sessionId;

  try {
    // Get initial terminal content via capture-pane
    const { getSessionBridge } = await import("./session-bridge.js");
    const bridge = getSessionBridge();
    const session = bridge.getSession(sessionId);

    if (!session) {
      sendToClient(client, { type: "error", message: "Session not found" });
      return;
    }

    // Ensure pipe-pane is attached for this session
    const connected = await bridge.connectClient(sessionId, `terminal-stream-${Date.now()}`);
    if (!connected.success) {
      sendToClient(client, { type: "error", message: connected.error ?? "Failed to connect" });
      return;
    }

    // Get current output buffer as initial content
    const content = connected.buffer?.join("\n") ?? "";

    sendToClient(client, {
      type: "subscribed",
      sessionId,
      content,
    });

    // Subscribe to EventBus for incremental output events
    const eventBus = getEventBus();
    const handler = (data: Record<string, unknown>) => {
      if (data['streamId'] !== sessionId) return;
      if (client.ws.readyState !== WebSocket.OPEN) return;

      const events = data['events'] as OutputEvent[];
      if (events && events.length > 0) {
        sendToClient(client, {
          type: "output",
          sessionId,
          events,
        });
      }
    };

    eventBus.on("stream:output", handler);
    client.eventHandler = handler;

    // Periodic full snapshot for sync recovery
    client.snapshotTimer = setInterval(async () => {
      if (client.ws.readyState !== WebSocket.OPEN) return;
      try {
        const { captureTmuxPane } = await import("./tmux.js");
        const snapshot = await captureTmuxPane(session.tmuxSession);
        sendToClient(client, {
          type: "snapshot",
          sessionId,
          content: snapshot,
        });
      } catch {
        // tmux pane might be gone — ignore
      }
    }, SNAPSHOT_INTERVAL_MS);

  } catch (err) {
    sendToClient(client, { type: "error", message: String(err) });
  }
}

function cleanup(client: StreamClient): void {
  if (client.eventHandler) {
    const eventBus = getEventBus();
    eventBus.off("stream:output", client.eventHandler);
    client.eventHandler = null;
  }
  if (client.snapshotTimer) {
    clearInterval(client.snapshotTimer);
    client.snapshotTimer = null;
  }
  client.sessionId = null;
}

function sendToClient(client: StreamClient, data: Record<string, unknown>): void {
  if (client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(data));
  }
}
