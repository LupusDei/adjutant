CREATE TABLE IF NOT EXISTS managed_sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  tmux_session TEXT NOT NULL,
  tmux_pane TEXT NOT NULL,
  project_path TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'swarm',
  status TEXT NOT NULL DEFAULT 'idle',
  workspace_type TEXT NOT NULL DEFAULT 'primary',
  pipe_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_activity TEXT NOT NULL
);
