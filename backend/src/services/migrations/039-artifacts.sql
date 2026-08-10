-- adj-j7az6.1.1 — Adjutant Artifacts: global/personal standalone HTML pages.
--
-- A first-class Artifacts library, decoupled from proposals and beads. Each artifact
-- is a self-contained single-page HTML document that can be viewed, shared via a
-- public no-API-key link (GET /a/:token), and downloaded as a .html file. Unlike
-- proposals, the page is preserved AS AUTHORED (sanitized + self-contained, but NOT
-- re-wrapped in the branded proposal "document" shell).
--
-- GLOBAL / personal: there is NO project_id — one fleet-wide library owned by the
-- Commander. Authored by agents (MCP) OR the Commander (web upload/paste).
--
--   id           — UUID primary key
--   title        — required display title
--   slug         — optional URL/download-friendly slug (used for the download filename)
--   description  — optional summary
--   html         — required self-contained HTML body (authored source; sanitized at compose time)
--   is_public    — 0 (private, default) | 1 (published; reachable via GET /a/:token)
--   share_token  — unguessable base62 handle for the public route (NULL until first publish)
--   published_at — ISO timestamp of first/most-recent publish (NULL while private)
--   created_by   — agent id or user who authored the artifact (nullable)
--   created_at / updated_at — ISO timestamps
--
-- share_token uniqueness is enforced by a UNIQUE index. SQLite treats NULLs as distinct
-- in a UNIQUE index, so any number of unpublished (NULL-token) artifacts coexist while
-- published tokens stay unique.

CREATE TABLE IF NOT EXISTS artifacts (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  slug         TEXT,
  description  TEXT,
  html         TEXT NOT NULL,
  is_public    INTEGER NOT NULL DEFAULT 0,
  share_token  TEXT UNIQUE,
  published_at TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- Public reads dial by token: `WHERE share_token = ? AND is_public = 1`. The UNIQUE
-- constraint on share_token already backs that lookup.
CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_share_token ON artifacts(share_token);
