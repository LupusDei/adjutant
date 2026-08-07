/**
 * Agent Status Stream — WebSocket endpoint for real-time agent status changes.
 *
 * Provides WS /api/agents/stream that forwards agent:status_changed events
 * from the EventBus to connected clients.
 *
 * Each event: { type: "status_change", agent: string, to: string, timestamp: string }
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import { getEventBus, type AgentStatusEvent } from "./event-bus.js";

/**
 * Ping/pong liveness sweep interval (adj-bgpup). Must be shorter than the
 * idle timeout of any proxy in front of us (ngrok, nginx) so a half-open
 * socket is detected here rather than lingering at the tunnel edge.
 */
const PING_INTERVAL_MS = 30_000;

let wss: WebSocketServer | null = null;
let livenessTimer: ReturnType<typeof setInterval> | null = null;

/** Sockets that have answered a ping since the last sweep. */
const alive = new WeakSet<WebSocket>();

/**
 * Initialize the agent status stream WebSocket server.
 */
export function initAgentStatusStream(server: HttpServer): WebSocketServer {
  if (wss) return wss;

  wss = new WebSocketServer({ noServer: true });

  // adj-bgpup: this stream sends data only when an agent changes status, so a
  // client that disappears without a close frame (tunnel drop, slept laptop)
  // was never noticed — the socket sat half-open holding a tunnel slot
  // forever, and every reconnect added another. Ping every client and
  // terminate the ones that didn't pong since the previous sweep.
  livenessTimer = setInterval(() => {
    const activeWss = wss;
    if (!activeWss) return;
    for (const ws of activeWss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      try {
        ws.ping();
      } catch {
        // Write failed — the next sweep terminates it.
      }
    }
  }, PING_INTERVAL_MS);
  livenessTimer.unref?.();

  server.on("upgrade", (request, socket, head) => {
    if (request.url === "/api/agents/stream") {
      wss!.handleUpgrade(request, socket, head, (ws) => {
        wss!.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", (ws) => {
    const eventBus = getEventBus();

    // Presumed alive on connect; refreshed by every pong (adj-bgpup).
    alive.add(ws);
    ws.on("pong", () => {
      alive.add(ws);
    });

    const handler = (data: AgentStatusEvent) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "status_change",
            agent: data.agent,
            to: data.status,
            timestamp: new Date().toISOString(),
          })
        );
      }
    };

    eventBus.on("agent:status_changed", handler);

    // adj-zm2fh: cleanup MUST run on both close AND error. The ws library's
    // 'close' event normally fires after 'error', but in production we observed
    // network-drop races where 'error' fires but 'close' is delayed enough
    // that listeners can leak under sustained churn. Guard with a single-shot
    // flag so we never double-off.
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      eventBus.off("agent:status_changed", handler);
      alive.delete(ws);
    };
    ws.on("close", cleanup);
    ws.on("error", () => {
      // adj-bgpup: an errored socket may not emit 'close' promptly — force it
      // so the connection (and its tunnel slot) is released now.
      cleanup();
      try {
        ws.terminate();
      } catch {
        // Already destroyed.
      }
    });
  });

  return wss;
}

/**
 * Close the agent status stream WebSocket server.
 */
export function closeAgentStatusStream(): void {
  if (livenessTimer) {
    clearInterval(livenessTimer);
    livenessTimer = null;
  }
  if (wss) {
    for (const ws of wss.clients) ws.close(1001, "Server shutting down");
    wss.close();
    wss = null;
  }
}
