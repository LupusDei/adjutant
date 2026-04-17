-- adj-162: Remove active project concept
-- All projects are always available. Project selection is client-side only.
-- SQLite 3.35+ supports ALTER TABLE DROP COLUMN natively.
-- better-sqlite3 12.6.2 bundles SQLite 3.51.2 — well above the minimum.
ALTER TABLE projects DROP COLUMN active;
