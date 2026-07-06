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
      linkStmt.run(messageId, attachmentId);
    },

    getById(id: string): MessageAttachment | null {
      const row = getByIdStmt.get(id) as AttachmentRow | undefined;
      return row !== undefined ? rowToAttachment(row) : null;
    },

    getByMessageId(messageId: string): MessageAttachment[] {
      return (getByMessageStmt.all(messageId) as AttachmentRow[]).map(rowToAttachment);
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
