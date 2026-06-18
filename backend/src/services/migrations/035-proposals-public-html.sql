-- adj-200.2.1 — Proposals as shareable standalone HTML pages.
--
-- Extends the proposals table with an optional self-contained HTML body and a
-- publish/share mechanism. The markdown `description` stays REQUIRED (search,
-- list previews, confidence scoring, legacy fallback); `html` is additive.
--
--   html         — optional self-contained HTML body authored by an agent (NULL = legacy/markdown-only)
--   is_public    — 0 (private, default) | 1 (published; reachable via GET /p/:token)
--   share_token  — unguessable base62 handle for the public route (NULL until first publish)
--   published_at — ISO timestamp of first/most-recent publish (NULL while private)
--
-- NOTE on share_token uniqueness: SQLite's `ALTER TABLE ADD COLUMN` cannot add a
-- column with an inline UNIQUE constraint, so uniqueness is enforced via a UNIQUE
-- INDEX instead. SQLite treats NULLs as distinct in a UNIQUE index, so any number
-- of unpublished (NULL-token) proposals coexist while published tokens stay unique.

ALTER TABLE proposals ADD COLUMN html TEXT;
ALTER TABLE proposals ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proposals ADD COLUMN share_token TEXT;
ALTER TABLE proposals ADD COLUMN published_at TEXT;

-- Public reads dial by token: `WHERE share_token = ? AND is_public = 1`. The share_token
-- UNIQUE index below already satisfies that lookup, so no standalone is_public index is
-- created — an index on a 2-value boolean adds write overhead for no read benefit
-- (adj-200.2.1.1).
CREATE UNIQUE INDEX IF NOT EXISTS idx_proposals_share_token ON proposals(share_token);
