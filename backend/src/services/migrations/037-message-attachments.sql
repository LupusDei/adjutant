-- adj-203.1.1 — Message attachments (Commander screenshot sharing).
--
-- First-class attachment records for images the Commander uploads and (optionally)
-- links to a chat message. The upload flow is decoupled from message send:
--   1. POST /api/uploads  → validates + stores the file, inserts an UNLINKED row
--      (message_id NULL) and returns its id.
--   2. POST /api/messages { attachmentIds } → links those rows to the created message.
--
-- storage_path holds the ABSOLUTE path of the stored file under ADJUTANT_UPLOAD_DIR.
-- That absolute path is what US2 injects into the target agent's tmux pane so the
-- agent's Claude can Read the screenshot.
--
-- kind:      'image' for MVP (png/jpeg/gif/webp). Column is free text so future
--            attachment kinds (pdf, video) can be added without a migration.
-- message_id: NULL until the attachment is linked on message send. FK → messages(id);
--            ON DELETE SET NULL so deleting a message orphans (does not delete) its
--            attachment rows — file retention is handled by the retention sweep, not
--            by message deletion.

CREATE TABLE IF NOT EXISTS message_attachments (
  id           TEXT NOT NULL PRIMARY KEY,
  message_id   TEXT
                 REFERENCES messages(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL DEFAULT 'image',
  storage_path TEXT NOT NULL,
  filename     TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dominant read: hydrate a message's attachments by message_id (getByMessageId).
CREATE INDEX IF NOT EXISTS idx_message_attachments_message
  ON message_attachments(message_id);

-- Retention sweep scans by age (deleteOlderThan).
CREATE INDEX IF NOT EXISTS idx_message_attachments_created
  ON message_attachments(created_at);
