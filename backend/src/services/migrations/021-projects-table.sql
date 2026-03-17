CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  git_remote TEXT,
  mode TEXT NOT NULL DEFAULT 'swarm',
  sessions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0
);
