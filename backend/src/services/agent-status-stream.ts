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
export function initAgentStatusStream(_server: HttpServer): WebSocketServer {
  if (wss) return wss;

  wss = new WebSocketServer({ noServer: true });

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

    ws.on("close", () => {
      eventBus.off("agent:status_changed", handler);
    });
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
