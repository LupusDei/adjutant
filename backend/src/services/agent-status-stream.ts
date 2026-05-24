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

let wss: WebSocketServer | null = null;

/**
 * Initialize the agent status stream WebSocket server.
 */
export function initAgentStatusStream(server: HttpServer): WebSocketServer {
  if (wss) return wss;

  wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    if (request.url === "/api/agents/stream") {
      wss!.handleUpgrade(request, socket, head, (ws) => {
        wss!.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", (ws) => {
    const eventBus = getEventBus();

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
    };
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });

  return wss;
}

/**
 * Close the agent status stream WebSocket server.
 */
export function closeAgentStatusStream(): void {
  if (wss) {
    wss.close();
    wss = null;
  }
}
