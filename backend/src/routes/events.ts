/**
 * SSE (Server-Sent Events) endpoint and Timeline API for Adjutant.
 *
 * GET /api/events - Real-time event stream for system-wide notifications.
 * GET /api/events/timeline - Paginated timeline of agent events.
 *
 * Event types (SSE):
 * - bead_update: Bead created/updated/closed
 * - agent_status: Agent status changes
 * - power_state: Power state transitions
 * - mail_received: New mail messages
 * - mail_read: Mail marked as read
 * - mode_changed: Deployment mode switch
 * - stream_status: Agent streaming state changes
 *
 * Supports Last-Event-ID for automatic gap recovery on reconnect.
 * Sends heartbeat comments every 15 seconds to keep connection alive.
 */

import { Router } from "express";
import { getEventBus, type EventName } from "../services/event-bus.js";
import { logInfo } from "../utils/index.js";
import type { EventStore } from "../services/event-store.js";
import { TimelineQuerySchema } from "../types/events.js";

/** Map internal event names to SSE event type names */
const EVENT_TYPE_MAP: Record<EventName, string> = {
  "bead:created": "bead_update",
  "bead:updated": "bead_update",
  "bead:closed": "bead_update",
  "agent:status_changed": "agent_status",
  "power:state_changed": "power_state",
  "mail:received": "mail_received",
  "mail:read": "mail_read",
  "mode:changed": "mode_changed",
  "stream:status": "stream_status",
  "session:cost": "session_cost",
  "session:cost_alert": "session_cost_alert",
  "session:permission": "session_permission",
  "stream:output": "stream_output",
  "mcp:agent_connected": "mcp_agent_connected",
  "mcp:agent_disconnected": "mcp_agent_disconnected",
};

/** Heartbeat interval (15 seconds) */
const HEARTBEAT_INTERVAL_MS = 15_000;

/** Track connected SSE clients for diagnostics */
let sseClientCount = 0;

/**
 * Create the events router with optional EventStore for the timeline endpoint.
 */
export function createEventsRouter(eventStore?: EventStore): Router {
  const router = Router();

  // =========================================================================
  // GET / — SSE stream for real-time system notifications
  // =========================================================================
  router.get("/", (req, res) => {
    // Set SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    });

    sseClientCount++;
    logInfo("SSE client connected", { clientCount: sseClientCount });

    // Check for Last-Event-ID for gap recovery
    const lastEventId = req.headers["last-event-id"];
    const lastSeq = lastEventId ? parseInt(lastEventId as string, 10) : 0;

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ seq: getEventBus().getSeq(), serverTime: new Date().toISOString() })}\n\n`);

    // Subscribe to all EventBus events
    const eventBus = getEventBus();

    const handler = (eventName: EventName, data: unknown, seq: number) => {
      // Skip events the client has already seen (gap recovery)
      if (seq <= lastSeq) return;

      const sseEventType = EVENT_TYPE_MAP[eventName];
      if (!sseEventType) return;

      // Add action field to disambiguate within event type (e.g., bead_update can be create/update/close)
      const payload = {
        ...(data as Record<string, unknown>),
        action: eventName.split(":")[1],
      };

      res.write(`id: ${seq}\nevent: ${sseEventType}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    eventBus.onAny(handler);

    // Heartbeat to keep connection alive through proxies
    const heartbeat = setInterval(() => {
      res.write(`: heartbeat ${new Date().toISOString()}\n\n`);
    }, HEARTBEAT_INTERVAL_MS);

    // Cleanup on disconnect
    const cleanup = () => {
      eventBus.offAny(handler);
      clearInterval(heartbeat);
      sseClientCount--;
      logInfo("SSE client disconnected", { clientCount: sseClientCount });
    };

    req.on("close", cleanup);
    req.on("error", cleanup);
  });

  // =========================================================================
  // GET /timeline — Paginated timeline of agent events
  // =========================================================================
  router.get("/timeline", (req, res) => {
    if (!eventStore) {
      res.status(503).json({ success: false, error: { code: "not_available", message: "Event store not initialized" } });
      return;
    }

    const parsed = TimelineQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { code: "validation_error", message: parsed.error.message } });
      return;
    }

    const query = parsed.data;
    const events = eventStore.getEvents(query);
    const hasMore = events.length === query.limit;

    res.json({ events, hasMore });
  });

  return router;
}

/** Backward-compatible static router (no eventStore, SSE only) */
export const eventsRouter = createEventsRouter();

/**
 * Get the current count of connected SSE clients.
 */
export function getSseClientCount(): number {
  return sseClientCount;
}
