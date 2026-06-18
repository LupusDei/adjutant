-- adj-201.1.1 — Per-project proposal style guide (v1: accent/brand color).
--
-- Adds an optional, per-project brand color guide. When an agent authors a
-- proposal for a project, it reads this guide (via the get_project_style MCP
-- tool) and authors the proposal HTML page to match the brand color. The guide
-- is AUTHORING-ONLY — the server never injects these tokens into a page.
--
--   brand_color_primary   — required hex (#RGB / #RRGGBB) when a guide is set; NULL = no guide
--   brand_color_secondary — optional hex; NULL when unset
--
-- An unset guide (both NULL) is a valid state. Clearing the primary clears the
-- whole guide (both columns NULL). Hex validation lives in the SERVICE layer
-- (projects-service.ts) as the single source of truth — these columns are plain
-- TEXT so legacy/manual writes are never silently rejected at the storage layer.

ALTER TABLE projects ADD COLUMN brand_color_primary TEXT;
ALTER TABLE projects ADD COLUMN brand_color_secondary TEXT;
