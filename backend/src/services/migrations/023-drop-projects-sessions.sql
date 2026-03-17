-- Drop the dead 'sessions' column from projects table.
-- This column was always '[]' and never updated with real data.
-- Session-to-project relationships are tracked in managed_sessions.project_path.
--
-- SQLite doesn't support DROP COLUMN before 3.35.0, so we recreate the table.

CREATE TABLE projects_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  git_remote TEXT,
  mode TEXT NOT NULL DEFAULT 'swarm',
  created_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0
);

INSERT INTO projects_new (id, name, path, git_remote, mode, created_at, active)
  SELECT id, name, path, git_remote, mode, created_at, active FROM projects;

DROP TABLE projects;

ALTER TABLE projects_new RENAME TO projects;
