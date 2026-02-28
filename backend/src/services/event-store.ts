import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { TimelineEvent, EventRow, TimelineQuery } from "../types/events.js";
import { wsBroadcast } from "./ws-server.js";

export interface InsertEventInput {
  eventType: string;
  agentId: string;
  action: string;
  detail?: Record<string, unknown>;
  beadId?: string;
  messageId?: string;
}

export interface EventStore {
  insertEvent(input: InsertEventInput): TimelineEvent;
  getEvents(query: Partial<TimelineQuery>): TimelineEvent[];
  pruneOldEvents(days: number): number;
}

function rowToEvent(row: EventRow): TimelineEvent {
  return {
    id: row.id,
    eventType: row.event_type as TimelineEvent["eventType"],
    agentId: row.agent_id,
    action: row.action,
    detail: row.detail !== null ? (JSON.parse(row.detail) as Record<string, unknown>) : null,
    beadId: row.bead_id,
    messageId: row.message_id,
    createdAt: row.created_at,
  };
}

export function createEventStore(db: Database.Database): EventStore {
  const insertStmt = db.prepare(`
    INSERT INTO events (id, event_type, agent_id, action, detail, bead_id, message_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const getByIdStmt = db.prepare("SELECT * FROM events WHERE id = ?");

  const pruneStmt = db.prepare(`
    DELETE FROM events WHERE created_at < datetime('now', '-' || ? || ' days')
  `);

  return {
    insertEvent(input: InsertEventInput): TimelineEvent {
      const id = randomUUID();
      const detailJson = input.detail !== undefined ? JSON.stringify(input.detail) : null;

      insertStmt.run(
        id,
        input.eventType,
        input.agentId,
        input.action,
        detailJson,
        input.beadId ?? null,
        input.messageId ?? null,
      );

      const row = getByIdStmt.get(id) as EventRow;
      const event = rowToEvent(row);

      // Broadcast to WebSocket clients
      wsBroadcast({
        type: "timeline_event",
        id: event.id,
        eventType: event.eventType,
        agentId: event.agentId,
        action: event.action,
        detail: event.detail,
        beadId: event.beadId,
        messageId: event.messageId ?? undefined,
        createdAt: event.createdAt,
      });

      return event;
    },

    getEvents(query: Partial<TimelineQuery>): TimelineEvent[] {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (query.agentId !== undefined) {
        conditions.push("agent_id = ?");
        params.push(query.agentId);
      }

      if (query.eventType !== undefined) {
        conditions.push("event_type = ?");
        params.push(query.eventType);
      }

      if (query.beadId !== undefined) {
        conditions.push("bead_id = ?");
        params.push(query.beadId);
      }

      if (query.before !== undefined) {
        conditions.push("created_at < ?");
        params.push(query.before);
      }

      if (query.after !== undefined) {
        conditions.push("created_at > ?");
        params.push(query.after);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const limit = query.limit ?? 50;
      params.push(limit);

      const sql = `SELECT * FROM events ${where} ORDER BY created_at DESC, id DESC LIMIT ?`;
      const rows = db.prepare(sql).all(...params) as EventRow[];
      return rows.map(rowToEvent);
    },

    pruneOldEvents(days: number): number {
      const result = pruneStmt.run(days);
      return result.changes;
    },
  };
}
