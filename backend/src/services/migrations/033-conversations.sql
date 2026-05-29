-- adj-164.1.1 — Unified conversation model (DMs + channels).
--
-- A conversation is the single first-class chat entity. `kind` discriminates
-- DMs (exactly two members) from channels (N members). Membership lives in
-- conversation_members. Every message carries a stable conversation_id, which
-- retires the fragile (agent_id = ? OR (role='user' AND recipient = ?))
-- reconstruction that caused wrong-thread bleed.

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('dm','channel')),
  title TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  member_kind TEXT NOT NULL CHECK(member_kind IN ('user','agent')),
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','owner')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_read_at TEXT,
  PRIMARY KEY (conversation_id, member_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- conversation_id on messages. ADD COLUMN is guarded so a re-run (e.g. a
-- partially-applied migration) does not abort the transaction.
ALTER TABLE messages ADD COLUMN conversation_id TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversation_members_member ON conversation_members(member_id);
CREATE INDEX IF NOT EXISTS idx_conversation_members_conversation ON conversation_members(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_kind ON conversations(kind);
