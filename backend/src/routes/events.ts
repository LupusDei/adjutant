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

/** Map internal event names to SSE event type names.
 *  Not every EventName needs an SSE mapping — some events (e.g. stream:output)
 *  are delivered only via dedicated WebSocket channels. */
const EVENT_TYPE_MAP: Partial<Record<EventName, string>> = {
  "bead:created": "bead_update",
  "bead:updated": "bead_update",
  "bead:closed": "bead_update",
  "bead:assigned": "bead_update",
  "agent:status_changed": "agent_status",
  "stream:status": "stream_status",
  "session:cost": "session_cost",
  "session:cost_alert": "session_cost_alert",
  "session:permission": "session_permission",
  "mcp:agent_connected": "mcp_agent_connected",
  "mcp:agent_disconnected": "mcp_agent_disconnected",
  "correction:detected": "correction_detected",
  "learning:created": "learning_created",
  "build:failed": "build_failed",
  "build:passed": "build_passed",
  "merge:completed": "merge_completed",
  "merge:conflict": "merge_conflict",
  "coordinator:action": "coordinator_action",
  "agent:spawn_failed": "agent_spawn_failed",
};

/** Heartbeat interval (15 seconds) */
const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Drop a stream after this long with no socket activity at all (adj-bgpup).
 * Node sets no socket timeout by default, so an abandoned SSE stream lived
 * until the process restarted.
 */
const IDLE_SOCKET_TIMEOUT_MS = 120_000;

/**
 * If this many bytes stay queued for a client, it has stopped reading — the
 * peer is gone but the socket is still nominally writable (the half-open case
 * behind a tunnel, where heartbeat writes succeed into a void). Reap it.
 */
const MAX_BUFFERED_BYTES = 1_000_000;

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

    /**
     * Cleanup on disconnect (adj-bgpup).
     *
     * Single-shot: 'close' and 'error' can both fire, and the old version
     * decremented the client gauge twice and re-ran teardown. It also never
     * ended the response, so a stream whose peer had vanished kept its
     * EventBus subscription, its heartbeat timer, and its socket — one leaked
     * connection per reconnect, which is what saturated the tunnel.
     */
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      eventBus.offAny(handler);
      clearInterval(heartbeat);
      sseClientCount--;
      logInfo("SSE client disconnected", { clientCount: sseClientCount });
      try {
        res.end();
        req.socket.destroy();
      } catch {
        // Socket already gone.
      }
    };

    // Heartbeat to keep connection alive through proxies. A failed write means
    // the peer is gone (half-open socket behind a tunnel) — reap immediately
    // rather than writing into the void forever.
    const heartbeat = setInterval(() => {
      if (
        closed ||
        res.writableEnded ||
        req.socket.destroyed ||
        res.writableLength > MAX_BUFFERED_BYTES
      ) {
        cleanup();
        return;
      }
      try {
        res.write(`: heartbeat ${new Date().toISOString()}\n\n`);
      } catch {
        cleanup();
      }
    }, HEARTBEAT_INTERVAL_MS);

    req.on("close", cleanup);
    req.on("error", cleanup);
    res.on("error", cleanup);
    // Drop a stream that has gone completely silent — no heartbeat ack, no
    // TCP activity. Node's default is no timeout, so these lived forever.
    req.socket.setTimeout(IDLE_SOCKET_TIMEOUT_MS, () => {
      cleanup();
    });
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
