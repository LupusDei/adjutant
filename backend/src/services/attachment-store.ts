/**
 * AttachmentStore (adj-203.1.2) — data layer for message attachments.
 *
 * Pure data-access over the `message_attachments` table (migration 037): no HTTP,
 * no filesystem, no WS. File I/O lives in upload-storage; orchestration in
 * upload-service / the message-send path.
 *
 * Lifecycle: an attachment is created UNLINKED (message_id NULL) by the upload
 * flow, then linked to a message on send (linkToMessage). Retention prunes old
 * rows via deleteOlderThan (returning the rows so the caller can delete the
 * backing files).
 */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MessageAttachment {
  id: string;
  messageId: string | null;
  kind: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

/**
 * Public, client-facing attachment shape (adj-203.2.5.1). Deliberately OMITS
 * `storagePath` (the absolute server filesystem path) — that is the ONLY sensitive
 * field, and stripping it is the whole point of this DTO. `messageId` and
 * `createdAt` ARE included: they are non-sensitive and the client models decode
 * them (iOS `MessageAttachment.createdAt` is non-optional — omitting it caused a
 * Swift decode failure "the data couldn't be read because it is missing", adj-206).
 * This is the ONLY attachment shape that may cross the wire to clients (WS + REST).
 */
export interface PublicMessageAttachment {
  id: string;
  messageId: string | null;
  kind: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

/** Strip an internal attachment down to its public, client-safe DTO (drops storagePath). */
export function toPublicMessageAttachment(a: MessageAttachment): PublicMessageAttachment {
  return {
    id: a.id,
    messageId: a.messageId,
    kind: a.kind,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    createdAt: a.createdAt,
  };
}

export interface CreateAttachmentInput {
  id?: string;
  messageId?: string;
  kind: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

interface AttachmentRow {
  id: string;
  message_id: string | null;
  kind: string;
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

function rowToAttachment(row: AttachmentRow): MessageAttachment {
  return {
    id: row.id,
    messageId: row.message_id,
    kind: row.kind,
    storagePath: row.storage_path,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface AttachmentStore {
  createAttachment(input: CreateAttachmentInput): MessageAttachment;
  linkToMessage(attachmentId: string, messageId: string): void;
  getById(id: string): MessageAttachment | null;
  getByMessageId(messageId: string): MessageAttachment[];
  /**
   * Batch variant of getByMessageId for the chat-history hot path (adj-203.2.6):
   * fetch attachments for many messages in ONE query and group by message id.
   * Every requested id is present in the returned map (empty array when none).
   */
  getByMessageIds(messageIds: string[]): Map<string, MessageAttachment[]>;
  /** Delete rows created strictly before `cutoffIso`; returns the deleted rows. */
  deleteOlderThan(cutoffIso: string): MessageAttachment[];
}

export function createAttachmentStore(db: Database.Database): AttachmentStore {
  const insertStmt = db.prepare(`
    INSERT INTO message_attachments
      (id, message_id, kind, storage_path, filename, mime_type, size_bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const getByIdStmt = db.prepare("SELECT * FROM message_attachments WHERE id = ?");
  const linkStmt = db.prepare("UPDATE message_attachments SET message_id = ? WHERE id = ?");
  const getByMessageStmt = db.prepare(
    "SELECT * FROM message_attachments WHERE message_id = ? ORDER BY created_at ASC, id ASC",
  );
  const selectOlderStmt = db.prepare("SELECT * FROM message_attachments WHERE created_at < ?");
  const deleteOlderStmt = db.prepare("DELETE FROM message_attachments WHERE created_at < ?");

  return {
    createAttachment(input: CreateAttachmentInput): MessageAttachment {
      const id = input.id ?? randomUUID();
      insertStmt.run(
        id,
        input.messageId ?? null,
        input.kind,
        input.storagePath,
        input.filename,
        input.mimeType,
        input.sizeBytes,
      );
      return rowToAttachment(getByIdStmt.get(id) as AttachmentRow);
    },

    linkToMessage(attachmentId: string, messageId: string): void {
      // adj-203.2.5 guard: the attachment must exist and be UNLINKED (or already
      // linked to this same message — idempotent). Reject unknown ids and any
      // attempt to re-parent an attachment owned by a different message (hijack).
      const row = getByIdStmt.get(attachmentId) as AttachmentRow | undefined;
      if (row === undefined) {
        throw new Error(`Attachment not found: ${attachmentId}`);
      }
      if (row.message_id !== null && row.message_id !== messageId) {
        throw new Error(
          `Attachment ${attachmentId} is already linked to message ${row.message_id}`,
        );
      }
      if (row.message_id === messageId) return; // idempotent no-op
      linkStmt.run(messageId, attachmentId);
    },

    getById(id: string): MessageAttachment | null {
      const row = getByIdStmt.get(id) as AttachmentRow | undefined;
      return row !== undefined ? rowToAttachment(row) : null;
    },

    getByMessageId(messageId: string): MessageAttachment[] {
      return (getByMessageStmt.all(messageId) as AttachmentRow[]).map(rowToAttachment);
    },

    getByMessageIds(messageIds: string[]): Map<string, MessageAttachment[]> {
      const grouped = new Map<string, MessageAttachment[]>();
      // Seed every requested id so callers get a stable [] for message-less ids.
      for (const id of messageIds) grouped.set(id, []);
      if (messageIds.length === 0) return grouped;

      // Single query over all ids. SQLite caps parameters (~999 default, ~32k in
      // modern builds); chunk to stay well under it while keeping O(1)-per-chunk.
      const CHUNK = 500;
      for (let i = 0; i < messageIds.length; i += CHUNK) {
        const chunk = messageIds.slice(i, i + CHUNK);
        const placeholders = chunk.map(() => "?").join(", ");
        const rows = db
          .prepare(
            `SELECT * FROM message_attachments WHERE message_id IN (${placeholders})
             ORDER BY created_at ASC, id ASC`,
          )
          .all(...chunk) as AttachmentRow[];
        for (const row of rows) {
          // message_id is non-null here (the WHERE clause matches it), but typed
          // string | null on the row; ! narrows without an unsafe cast.
          const list = row.message_id !== null ? grouped.get(row.message_id) : undefined;
          if (list !== undefined) list.push(rowToAttachment(row));
        }
      }
      return grouped;
    },

    deleteOlderThan(cutoffIso: string): MessageAttachment[] {
      // Read-then-delete in a transaction so the returned rows exactly match
      // what was removed (the caller uses storage_path to delete backing files).
      const tx = db.transaction((cutoff: string) => {
        const rows = (selectOlderStmt.all(cutoff) as AttachmentRow[]).map(rowToAttachment);
        deleteOlderStmt.run(cutoff);
        return rows;
      });
      return tx(cutoffIso);
    },
  };
}
