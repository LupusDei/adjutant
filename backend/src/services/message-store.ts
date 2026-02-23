import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export interface Message {
  id: string;
  sessionId: string | null;
  agentId: string;
  recipient: string | null;
  role: "user" | "agent" | "system" | "announcement";
  body: string;
  metadata: Record<string, unknown> | null;
  deliveryStatus: "pending" | "sent" | "delivered" | "read" | "failed";
  eventType: string | null;
  threadId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Thread {
  threadId: string;
  messageCount: number;
  latestBody: string;
  latestCreatedAt: string;
  agentId: string;
}

interface InsertMessageInput {
  id?: string;
  agentId: string;
  recipient?: string;
  role: "user" | "agent" | "system" | "announcement";
  body: string;
  metadata?: Record<string, unknown>;
  sessionId?: string;
  threadId?: string;
  eventType?: string;
}

interface GetMessagesOptions {
  agentId?: string;
  recipient?: string;
  threadId?: string;
  sessionId?: string;
  before?: string;
  beforeId?: string;
  after?: string;
  afterId?: string;
  limit?: number;
}

interface SearchOptions {
  agentId?: string | undefined;
  limit?: number | undefined;
}

interface UnreadCount {
  agentId: string;
  count: number;
}

/** Raw row shape from SQLite before camelCase mapping */
interface MessageRow {
  id: string;
  session_id: string | null;
  agent_id: string;
  recipient: string | null;
  role: string;
  body: string;
  metadata: string | null;
  delivery_status: string;
  event_type: string | null;
  thread_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ThreadRow {
  thread_id: string;
  message_count: number;
  latest_body: string;
  latest_created_at: string;
  agent_id: string;
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    agentId: row.agent_id,
    recipient: row.recipient,
    role: row.role as Message["role"],
    body: row.body,
    metadata: row.metadata !== null ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
    deliveryStatus: row.delivery_status as Message["deliveryStatus"],
    eventType: row.event_type,
    threadId: row.thread_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToThread(row: ThreadRow): Thread {
  return {
    threadId: row.thread_id,
    messageCount: row.message_count,
    latestBody: row.latest_body,
    latestCreatedAt: row.latest_created_at,
    agentId: row.agent_id,
  };
}

export interface MessageStore {
  insertMessage(input: InsertMessageInput): Message;
  getMessage(id: string): Message | null;
  getMessages(opts: GetMessagesOptions): Message[];
  markDelivered(id: string): void;
  markRead(id: string): void;
  markAllRead(agentId: string): void;
  searchMessages(query: string, opts?: SearchOptions): Message[];
  getUnreadCounts(): UnreadCount[];
  getThreads(agentId?: string): Thread[];
}

export function createMessageStore(db: Database.Database): MessageStore {
  const insertStmt = db.prepare(`
    INSERT INTO messages (id, session_id, agent_id, recipient, role, body, metadata, delivery_status, event_type, thread_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, datetime('now'), datetime('now'))
  `);

  const getByIdStmt = db.prepare("SELECT * FROM messages WHERE id = ?");

  const markDeliveredStmt = db.prepare(`
    UPDATE messages SET delivery_status = 'delivered', updated_at = datetime('now')
    WHERE id = ? AND delivery_status = 'pending'
  `);

  const markReadStmt = db.prepare(`
    UPDATE messages SET delivery_status = 'read', updated_at = datetime('now') WHERE id = ?
  `);

  const markAllReadStmt = db.prepare(`
    UPDATE messages SET delivery_status = 'read', updated_at = datetime('now')
    WHERE agent_id = ? AND delivery_status != 'read'
  `);

  const unreadCountsStmt = db.prepare(`
    SELECT agent_id, COUNT(*) as count FROM messages
    WHERE delivery_status != 'read'
    GROUP BY agent_id
  `);

  return {
    insertMessage(input: InsertMessageInput): Message {
      const id = input.id ?? randomUUID();
      const metadataJson = input.metadata !== undefined ? JSON.stringify(input.metadata) : null;

      insertStmt.run(
        id,
        input.sessionId ?? null,
        input.agentId,
        input.recipient ?? null,
        input.role,
        input.body,
        metadataJson,
        input.eventType ?? null,
        input.threadId ?? null,
      );

      const row = getByIdStmt.get(id) as MessageRow;
      return rowToMessage(row);
    },

    getMessage(id: string): Message | null {
      const row = getByIdStmt.get(id) as MessageRow | undefined;
      return row !== undefined ? rowToMessage(row) : null;
    },

    getMessages(opts: GetMessagesOptions): Message[] {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (opts.agentId !== undefined) {
        conditions.push("(agent_id = ? OR (role = 'user' AND recipient = ?))");
        params.push(opts.agentId, opts.agentId);
      }

      if (opts.recipient !== undefined) {
        conditions.push("recipient = ?");
        params.push(opts.recipient);
      }

      if (opts.threadId !== undefined) {
        conditions.push("thread_id = ?");
        params.push(opts.threadId);
      }

      if (opts.sessionId !== undefined) {
        conditions.push("session_id = ?");
        params.push(opts.sessionId);
      }

      // Resolve beforeId to timestamp when before is missing (iOS sends only beforeId)
      if (opts.beforeId !== undefined && opts.before === undefined) {
        const ref = getByIdStmt.get(opts.beforeId) as MessageRow | undefined;
        if (ref) opts.before = ref.created_at;
      }

      // Composite cursor pagination: (created_at, id) to handle same-second ties
      if (opts.before !== undefined) {
        const beforeId = opts.beforeId;
        if (beforeId !== undefined) {
          conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
          params.push(opts.before, opts.before, beforeId);
        } else {
          conditions.push("created_at < ?");
          params.push(opts.before);
        }
      }

      if (opts.after !== undefined) {
        const afterId = opts.afterId;
        if (afterId !== undefined) {
          conditions.push("(created_at > ? OR (created_at = ? AND id > ?))");
          params.push(opts.after, opts.after, afterId);
        } else {
          conditions.push("created_at > ?");
          params.push(opts.after);
        }
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const limitClause = opts.limit !== undefined ? "LIMIT ?" : "";
      if (opts.limit !== undefined) {
        params.push(opts.limit);
      }

      const sql = `SELECT * FROM messages ${where} ORDER BY created_at DESC, id DESC ${limitClause}`;
      const rows = db.prepare(sql).all(...params) as MessageRow[];
      return rows.map(rowToMessage);
    },

    markDelivered(id: string): void {
      markDeliveredStmt.run(id);
    },

    markRead(id: string): void {
      markReadStmt.run(id);
    },

    markAllRead(agentId: string): void {
      markAllReadStmt.run(agentId);
    },

    searchMessages(query: string, opts?: SearchOptions): Message[] {
      if (!query || query.trim().length === 0) return [];
      // Sanitize FTS5 query: wrap in double quotes to treat as literal phrase,
      // escaping any internal double quotes to prevent FTS5 syntax errors
      const sanitized = '"' + query.trim().replace(/"/g, '""') + '"';
      const conditions: string[] = ["m.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)"];
      const params: unknown[] = [sanitized];

      if (opts?.agentId !== undefined) {
        conditions.push("(m.agent_id = ? OR (m.role = 'user' AND m.recipient = ?))");
        params.push(opts.agentId, opts.agentId);
      }

      const where = conditions.join(" AND ");
      const limitClause = opts?.limit !== undefined ? "LIMIT ?" : "";
      if (opts?.limit !== undefined) {
        params.push(opts.limit);
      }

      const sql = `SELECT m.* FROM messages m WHERE ${where} ORDER BY m.created_at DESC ${limitClause}`;
      const rows = db.prepare(sql).all(...params) as MessageRow[];
      return rows.map(rowToMessage);
    },

    getUnreadCounts(): UnreadCount[] {
      const rows = unreadCountsStmt.all() as Array<{ agent_id: string; count: number }>;
      return rows.map((r) => ({ agentId: r.agent_id, count: r.count }));
    },

    getThreads(agentId?: string): Thread[] {
      const conditions: string[] = ["thread_id IS NOT NULL"];
      const params: unknown[] = [];

      if (agentId !== undefined) {
        conditions.push("agent_id = ?");
        params.push(agentId);
      }

      const where = conditions.join(" AND ");

      const sql = `
        SELECT
          thread_id,
          COUNT(*) as message_count,
          (SELECT body FROM messages m2 WHERE m2.thread_id = messages.thread_id ORDER BY created_at DESC LIMIT 1) as latest_body,
          MAX(created_at) as latest_created_at,
          agent_id
        FROM messages
        WHERE ${where}
        GROUP BY thread_id
        ORDER BY latest_created_at DESC
      `;

      const rows = db.prepare(sql).all(...params) as ThreadRow[];
      return rows.map(rowToThread);
    },
  };
}
