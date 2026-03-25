ALTER TABLE projects ADD COLUMN auto_develop INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN auto_develop_paused_at TEXT;
ALTER TABLE projects ADD COLUMN vision_context TEXT;
